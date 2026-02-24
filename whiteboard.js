(function () {
  'use strict';

  const canvas = document.getElementById('wb-canvas');
  const ctx = canvas.getContext('2d');
  const container = document.getElementById('wb-canvas-container');
  const panel = document.getElementById('whiteboard-panel');
  const textInput = document.getElementById('wb-text-input');

  let shapes = [];
  let selectedIdx = -1;
  let currentTool = 'select';
  let offset = { x: 0, y: 0 };
  let scale = 1;
  let history = [[]];
  let historyIdx = 0;
  const MAX_HISTORY = 50;

  let isDrawing = false;
  let isDragging = false;
  let isPanning = false;
  let spaceHeld = false;
  let drawStart = { x: 0, y: 0 };
  let panStart = { x: 0, y: 0 };
  let dragOffset = { x: 0, y: 0 };
  let resizeHandle = -1;
  let currentShape = null;

  let strokeColor = '#ffffff';
  let fillColor = '#3a3a55';
  let noFill = true;
  let strokeWidth = 2;

  const STICKY_COLORS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#fcd5b4'];
  let stickyColorIdx = 0;

  function screenToCanvas(sx, sy) {
    const rect = canvas.getBoundingClientRect();
    return { x: (sx - rect.left - offset.x) / scale, y: (sy - rect.top - offset.y) / scale };
  }

  function canvasToScreen(cx, cy) {
    return { x: cx * scale + offset.x, y: cy * scale + offset.y };
  }

  function init() {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    document.querySelectorAll('.wb-tool-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { setTool(btn.dataset.tool); });
    });
    document.querySelectorAll('.wb-sw-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        strokeWidth = parseInt(btn.dataset.width);
        document.querySelectorAll('.wb-sw-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        if (selectedIdx >= 0) { shapes[selectedIdx].strokeWidth = strokeWidth; saveHistory(); render(); }
      });
    });
    document.getElementById('wb-stroke-color').addEventListener('input', function (e) {
      strokeColor = e.target.value;
      if (selectedIdx >= 0) {
        var s = shapes[selectedIdx];
        if (s.type === 'text') s.color = strokeColor; else s.stroke = strokeColor;
        saveHistory(); render();
      }
    });
    document.getElementById('wb-fill-color').addEventListener('input', function (e) {
      fillColor = e.target.value;
      if (selectedIdx >= 0 && !noFill) {
        var s = shapes[selectedIdx];
        if (s.type !== 'pen' && s.type !== 'line' && s.type !== 'arrow' && s.type !== 'text') {
          s.fill = fillColor; saveHistory(); render();
        }
      }
    });
    document.getElementById('wb-no-fill').addEventListener('change', function (e) {
      noFill = e.target.checked;
      if (selectedIdx >= 0) {
        var s = shapes[selectedIdx];
        if (s.type !== 'pen' && s.type !== 'line' && s.type !== 'arrow' && s.type !== 'text') {
          s.fill = noFill ? 'transparent' : fillColor; saveHistory(); render();
        }
      }
    });
    document.getElementById('wb-undo').addEventListener('click', undo);
    document.getElementById('wb-redo').addEventListener('click', redo);
    document.getElementById('wb-clear').addEventListener('click', clearCanvas);
    document.getElementById('wb-zoom-in').addEventListener('click', function () { zoomBy(1.2); });
    document.getElementById('wb-zoom-out').addEventListener('click', function () { zoomBy(1 / 1.2); });
    document.getElementById('wb-zoom-reset').addEventListener('click', resetZoom);
    textInput.addEventListener('blur', commitText);
    textInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') cancelText();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); }
      e.stopPropagation();
    });
    textInput.addEventListener('input', autoResizeTextInput);
    setTool('select');
    updateUndoRedoState();
    render();
  }

  function resizeCanvas() {
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    render();
  }

  function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll('.wb-tool-btn').forEach(function (b) { b.classList.remove('active'); });
    var btn = document.querySelector('.wb-tool-btn[data-tool="' + tool + '"]');
    if (btn) btn.classList.add('active');
    container.className = 'wb-canvas-container tool-' + tool;
    if (tool !== 'select') { selectedIdx = -1; render(); }
  }

  // ── Mouse Events ──
  function onMouseDown(e) {
    if (e.button === 2) return;
    var pos = screenToCanvas(e.clientX, e.clientY);
    if (e.button === 1 || spaceHeld || currentTool === 'pan') { startPan(e.clientX, e.clientY); return; }
    switch (currentTool) {
      case 'select': handleSelectDown(pos); break;
      case 'pen': startPen(pos); break;
      case 'rect': case 'ellipse': case 'diamond': case 'line': case 'arrow': startShapeDraw(pos); break;
      case 'text': startTextInput(pos); break;
      case 'sticky': placeSticky(pos); break;
    }
  }

  function onMouseMove(e) {
    var pos = screenToCanvas(e.clientX, e.clientY);
    if (isPanning) { offset.x = e.clientX - panStart.x; offset.y = e.clientY - panStart.y; render(); return; }
    if (isDrawing && currentShape) { updateShapeDraw(pos); return; }
    if (isDragging && selectedIdx >= 0) {
      if (resizeHandle >= 0) resizeSelectedShape(pos); else moveShape(pos);
      render(); return;
    }
    if (currentTool === 'select') updateSelectCursor(pos);
  }

  function onMouseUp() {
    if (isPanning) { isPanning = false; container.classList.remove('panning'); return; }
    if (isDrawing && currentShape) { finishShapeDraw(); return; }
    if (isDragging) { isDragging = false; resizeHandle = -1; if (selectedIdx >= 0) saveHistory(); }
  }

  function onTouchStart(e) {
    if (e.touches.length === 1) { e.preventDefault(); var t = e.touches[0]; onMouseDown({ clientX: t.clientX, clientY: t.clientY, button: 0 }); }
  }
  function onTouchMove(e) {
    if (e.touches.length === 1) { e.preventDefault(); var t = e.touches[0]; onMouseMove({ clientX: t.clientX, clientY: t.clientY }); }
  }
  function onTouchEnd() { onMouseUp(); }

  // ── Pan & Zoom ──
  function startPan(cx, cy) { isPanning = true; panStart = { x: cx - offset.x, y: cy - offset.y }; container.classList.add('panning'); }

  function onWheel(e) {
    e.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left, my = e.clientY - rect.top;
    var factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    var newScale = Math.min(5, Math.max(0.1, scale * factor));
    var ratio = newScale / scale;
    offset.x = mx - (mx - offset.x) * ratio;
    offset.y = my - (my - offset.y) * ratio;
    scale = newScale;
    render();
  }

  function zoomBy(factor) {
    var cx = canvas.width / 2, cy = canvas.height / 2;
    var newScale = Math.min(5, Math.max(0.1, scale * factor));
    var ratio = newScale / scale;
    offset.x = cx - (cx - offset.x) * ratio;
    offset.y = cy - (cy - offset.y) * ratio;
    scale = newScale; render();
  }

  function resetZoom() { scale = 1; offset = { x: 0, y: 0 }; render(); }

  // ── Select Tool ──
  function handleSelectDown(pos) {
    if (selectedIdx >= 0) {
      var handle = hitTestHandles(shapes[selectedIdx], pos);
      if (handle >= 0) { resizeHandle = handle; isDragging = true; drawStart = { x: pos.x, y: pos.y }; return; }
    }
    var hitIdx = hitTestShapes(pos);
    if (hitIdx >= 0) {
      selectedIdx = hitIdx; isDragging = true; resizeHandle = -1;
      var bbox = getBBox(shapes[hitIdx]);
      dragOffset = { x: pos.x - bbox.x, y: pos.y - bbox.y };
    } else { selectedIdx = -1; }
    render();
  }

  function moveShape(pos) {
    var s = shapes[selectedIdx]; var bbox = getBBox(s);
    var dx = pos.x - dragOffset.x - bbox.x, dy = pos.y - dragOffset.y - bbox.y;
    if (s.type === 'rect' || s.type === 'ellipse' || s.type === 'diamond' || s.type === 'sticky') { s.x += dx; s.y += dy; }
    else if (s.type === 'line' || s.type === 'arrow') { s.x1 += dx; s.y1 += dy; s.x2 += dx; s.y2 += dy; }
    else if (s.type === 'pen') { for (var i = 0; i < s.points.length; i++) { s.points[i].x += dx; s.points[i].y += dy; } }
    else if (s.type === 'text') { s.x += dx; s.y += dy; }
  }

  function resizeSelectedShape(pos) {
    var s = shapes[selectedIdx]; var bbox = getBBox(s); var h = resizeHandle;
    var nx = bbox.x, ny = bbox.y, nw = bbox.w, nh = bbox.h;
    if (h === 0 || h === 3 || h === 5) { nw = bbox.x + bbox.w - pos.x; nx = pos.x; }
    if (h === 2 || h === 4 || h === 7) { nw = pos.x - bbox.x; }
    if (h === 0 || h === 1 || h === 2) { nh = bbox.y + bbox.h - pos.y; ny = pos.y; }
    if (h === 5 || h === 6 || h === 7) { nh = pos.y - bbox.y; }
    if (nw < 0) { nx += nw; nw = -nw; } if (nh < 0) { ny += nh; nh = -nh; }
    if (nw < 5) nw = 5; if (nh < 5) nh = 5;
    applyBBox(s, nx, ny, nw, nh, bbox);
  }

  function applyBBox(s, nx, ny, nw, nh, ob) {
    if (s.type === 'rect' || s.type === 'ellipse' || s.type === 'diamond' || s.type === 'sticky') { s.x = nx; s.y = ny; s.w = nw; s.h = nh; }
    else if (s.type === 'line' || s.type === 'arrow') {
      var sx = nw / (ob.w || 1), sy = nh / (ob.h || 1);
      s.x1 = nx + (s.x1 - ob.x) * sx; s.y1 = ny + (s.y1 - ob.y) * sy;
      s.x2 = nx + (s.x2 - ob.x) * sx; s.y2 = ny + (s.y2 - ob.y) * sy;
    } else if (s.type === 'pen') {
      var sx2 = nw / (ob.w || 1), sy2 = nh / (ob.h || 1);
      for (var i = 0; i < s.points.length; i++) { s.points[i].x = nx + (s.points[i].x - ob.x) * sx2; s.points[i].y = ny + (s.points[i].y - ob.y) * sy2; }
    } else if (s.type === 'text') { s.x = nx; s.y = ny; }
  }

  function updateSelectCursor(pos) {
    if (selectedIdx >= 0) {
      var handle = hitTestHandles(shapes[selectedIdx], pos);
      if (handle >= 0) { var c = ['nw-resize','n-resize','ne-resize','w-resize','e-resize','sw-resize','s-resize','se-resize']; canvas.style.cursor = c[handle]; return; }
    }
    canvas.style.cursor = hitTestShapes(pos) >= 0 ? 'move' : 'default';
  }

  // ── Drawing Tools ──
  function startPen(pos) {
    isDrawing = true;
    currentShape = { type: 'pen', points: [{ x: pos.x, y: pos.y }], stroke: strokeColor, strokeWidth: strokeWidth };
  }

  function startShapeDraw(pos) {
    isDrawing = true; drawStart = { x: pos.x, y: pos.y };
    var fill = noFill ? 'transparent' : fillColor;
    if (currentTool === 'rect') currentShape = { type: 'rect', x: pos.x, y: pos.y, w: 0, h: 0, stroke: strokeColor, fill: fill, strokeWidth: strokeWidth };
    else if (currentTool === 'ellipse') currentShape = { type: 'ellipse', x: pos.x, y: pos.y, w: 0, h: 0, stroke: strokeColor, fill: fill, strokeWidth: strokeWidth };
    else if (currentTool === 'diamond') currentShape = { type: 'diamond', x: pos.x, y: pos.y, w: 0, h: 0, stroke: strokeColor, fill: fill, strokeWidth: strokeWidth };
    else if (currentTool === 'line') currentShape = { type: 'line', x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y, stroke: strokeColor, strokeWidth: strokeWidth };
    else if (currentTool === 'arrow') currentShape = { type: 'arrow', x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y, stroke: strokeColor, strokeWidth: strokeWidth };
  }

  function updateShapeDraw(pos) {
    if (!currentShape) return;
    if (currentShape.type === 'pen') { currentShape.points.push({ x: pos.x, y: pos.y }); }
    else if (currentShape.type === 'line' || currentShape.type === 'arrow') { currentShape.x2 = pos.x; currentShape.y2 = pos.y; }
    else { currentShape.w = pos.x - drawStart.x; currentShape.h = pos.y - drawStart.y; }
    render();
  }

  function finishShapeDraw() {
    isDrawing = false; if (!currentShape) return;
    if (currentShape.type === 'rect' || currentShape.type === 'ellipse' || currentShape.type === 'diamond') {
      if (currentShape.w < 0) { currentShape.x += currentShape.w; currentShape.w = -currentShape.w; }
      if (currentShape.h < 0) { currentShape.y += currentShape.h; currentShape.h = -currentShape.h; }
      if (currentShape.w < 3 && currentShape.h < 3) { currentShape = null; return; }
    }
    if (currentShape.type === 'line' || currentShape.type === 'arrow') {
      var dx = currentShape.x2 - currentShape.x1, dy = currentShape.y2 - currentShape.y1;
      if (Math.sqrt(dx * dx + dy * dy) < 3) { currentShape = null; return; }
    }
    if (currentShape.type === 'pen') {
      if (currentShape.points.length < 2) { currentShape = null; return; }
      currentShape.points = simplifyPoints(currentShape.points, 1.5);
    }
    shapes.push(currentShape); selectedIdx = shapes.length - 1; currentShape = null;
    saveHistory(); setTool('select'); render();
  }

  // ── Text Tool ──
  var editingTextIdx = -1;

  function startTextInput(pos) {
    var screenPos = canvasToScreen(pos.x, pos.y);
    var rect = canvas.getBoundingClientRect();
    var panelRect = panel.getBoundingClientRect();
    textInput.value = '';
    textInput.style.display = 'block';
    textInput.style.left = (screenPos.x + rect.left - panelRect.left) + 'px';
    textInput.style.top = (screenPos.y + rect.top - panelRect.top) + 'px';
    textInput.style.fontSize = (18 * scale) + 'px';
    textInput.style.color = strokeColor;
    textInput.style.width = 'auto';
    textInput.style.background = 'transparent';
    textInput.dataset.cx = pos.x; textInput.dataset.cy = pos.y;
    editingTextIdx = -1; textInput.focus();
  }

  function commitText() {
    var text = textInput.value.trim();
    if (text && editingTextIdx === -1) {
      shapes.push({ type: 'text', x: parseFloat(textInput.dataset.cx), y: parseFloat(textInput.dataset.cy), text: text, color: strokeColor, fontSize: 18 });
      saveHistory();
    } else if (text && editingTextIdx >= 0) { shapes[editingTextIdx].text = text; saveHistory(); }
    textInput.style.display = 'none'; textInput.value = ''; editingTextIdx = -1;
    setTool('select'); render();
  }

  function cancelText() { textInput.style.display = 'none'; textInput.value = ''; editingTextIdx = -1; setTool('select'); }
  function autoResizeTextInput() { textInput.style.height = 'auto'; textInput.style.height = textInput.scrollHeight + 'px'; }

  // ── Sticky Note ──
  function placeSticky(pos) {
    var color = STICKY_COLORS[stickyColorIdx % STICKY_COLORS.length]; stickyColorIdx++;
    shapes.push({ type: 'sticky', x: pos.x - 75, y: pos.y - 50, w: 150, h: 100, text: '', bgColor: color, stroke: 'transparent', fill: color, strokeWidth: 0 });
    selectedIdx = shapes.length - 1; saveHistory(); setTool('select'); render();
  }

  // ── Double Click ──
  function onDblClick(e) {
    var pos = screenToCanvas(e.clientX, e.clientY);
    var hitIdx = hitTestShapes(pos);
    if (hitIdx < 0) return;
    var s = shapes[hitIdx];
    if (s.type !== 'text' && s.type !== 'sticky') return;
    editingTextIdx = hitIdx;
    var screenPos = canvasToScreen(s.x, s.y);
    var rect = canvas.getBoundingClientRect(); var panelRect = panel.getBoundingClientRect();
    textInput.value = s.text || '';
    textInput.style.display = 'block';
    textInput.style.left = (screenPos.x + rect.left - panelRect.left) + 'px';
    textInput.style.top = (screenPos.y + rect.top - panelRect.top) + 'px';
    textInput.style.fontSize = ((s.fontSize || 14) * scale) + 'px';
    textInput.style.color = s.type === 'sticky' ? '#333' : s.color;
    textInput.dataset.cx = s.x; textInput.dataset.cy = s.y;
    if (s.type === 'sticky') { textInput.style.width = (s.w * scale) + 'px'; textInput.style.background = s.bgColor; }
    else { textInput.style.width = 'auto'; textInput.style.background = 'transparent'; }
    textInput.focus(); autoResizeTextInput();
  }

  // ── Keyboard ──
  function onKeyDown(e) {
    if (e.target === textInput) return;
    if (e.target.closest && e.target.closest('.calculator')) return;
    var isWb = e.target === canvas || e.target === document.body || (e.target.closest && e.target.closest('.whiteboard-panel'));
    if (e.key === ' ' && isWb) { e.preventDefault(); spaceHeld = true; container.classList.add('panning'); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey && isWb) { e.preventDefault(); undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || e.key === 'y') && isWb) { e.preventDefault(); redo(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdx >= 0 && isWb) { e.preventDefault(); shapes.splice(selectedIdx, 1); selectedIdx = -1; saveHistory(); render(); return; }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && isWb) {
      var m = { v:'select', h:'pan', p:'pen', r:'rect', e:'ellipse', d:'diamond', l:'line', a:'arrow', t:'text', s:'sticky' };
      var tool = m[e.key.toLowerCase()]; if (tool) { setTool(tool); return; }
    }
    if (e.key === 'Escape') { if (textInput.style.display !== 'none') cancelText(); else { selectedIdx = -1; render(); } }
  }

  function onKeyUp(e) { if (e.key === ' ') { spaceHeld = false; if (!isPanning) container.classList.remove('panning'); } }

  // ── Hit Testing ──
  function hitTestShapes(pos) {
    for (var i = shapes.length - 1; i >= 0; i--) { if (hitTestShape(shapes[i], pos)) return i; }
    return -1;
  }

  function hitTestShape(s, pos) {
    var tol = 6 / scale;
    switch (s.type) {
      case 'rect': return ptInRect(pos, s.x, s.y, s.w, s.h, tol);
      case 'ellipse': return ptInEllipse(pos, s.x + s.w/2, s.y + s.h/2, s.w/2, s.h/2, tol);
      case 'diamond': return ptInDiamond(pos, s.x, s.y, s.w, s.h, tol);
      case 'line': case 'arrow': return ptNearLine(pos, s.x1, s.y1, s.x2, s.y2, tol);
      case 'pen': return ptNearPath(pos, s.points, tol);
      case 'text': var tw = measureText(s).w; return ptInRect(pos, s.x, s.y, tw, s.fontSize * 1.2, tol);
      case 'sticky': return ptInRect(pos, s.x, s.y, s.w, s.h, tol);
      default: return false;
    }
  }

  function ptInRect(p, x, y, w, h, t) { return p.x >= x - t && p.x <= x + w + t && p.y >= y - t && p.y <= y + h + t; }
  function ptInEllipse(p, cx, cy, rx, ry, t) { var dx = (p.x-cx)/(rx+t), dy = (p.y-cy)/(ry+t); return dx*dx+dy*dy <= 1; }
  function ptInDiamond(p, x, y, w, h, t) { var dx = Math.abs(p.x-x-w/2)/(w/2+t), dy = Math.abs(p.y-y-h/2)/(h/2+t); return dx+dy <= 1; }
  function ptNearLine(p, x1, y1, x2, y2, t) {
    var dx=x2-x1, dy=y2-y1, lenSq=dx*dx+dy*dy;
    if (lenSq===0) return Math.hypot(p.x-x1,p.y-y1)<=t;
    var u=Math.max(0,Math.min(1,((p.x-x1)*dx+(p.y-y1)*dy)/lenSq));
    return Math.hypot(p.x-(x1+u*dx),p.y-(y1+u*dy))<=t;
  }
  function ptNearPath(p, pts, t) { for (var i=1;i<pts.length;i++) { if (ptNearLine(p,pts[i-1].x,pts[i-1].y,pts[i].x,pts[i].y,t)) return true; } return false; }

  // ── Selection Handles ──
  function getHandles(s) {
    var b = getBBox(s); var mx=b.x+b.w/2, my=b.y+b.h/2;
    return [ {x:b.x,y:b.y},{x:mx,y:b.y},{x:b.x+b.w,y:b.y},{x:b.x,y:my},{x:b.x+b.w,y:my},{x:b.x,y:b.y+b.h},{x:mx,y:b.y+b.h},{x:b.x+b.w,y:b.y+b.h} ];
  }

  function hitTestHandles(s, pos) {
    var handles = getHandles(s); var sz = 8 / scale;
    for (var i = 0; i < handles.length; i++) { if (Math.abs(pos.x-handles[i].x)<=sz && Math.abs(pos.y-handles[i].y)<=sz) return i; }
    return -1;
  }

  // ── Bounding Box ──
  function getBBox(s) {
    if (s.type==='rect'||s.type==='ellipse'||s.type==='diamond'||s.type==='sticky') return {x:s.x,y:s.y,w:s.w,h:s.h};
    if (s.type==='line'||s.type==='arrow') { var x=Math.min(s.x1,s.x2),y=Math.min(s.y1,s.y2); return {x:x,y:y,w:Math.abs(s.x2-s.x1),h:Math.abs(s.y2-s.y1)}; }
    if (s.type==='pen') {
      if(!s.points.length)return{x:0,y:0,w:0,h:0};
      var mnX=Infinity,mnY=Infinity,mxX=-Infinity,mxY=-Infinity;
      for(var i=0;i<s.points.length;i++){if(s.points[i].x<mnX)mnX=s.points[i].x;if(s.points[i].y<mnY)mnY=s.points[i].y;if(s.points[i].x>mxX)mxX=s.points[i].x;if(s.points[i].y>mxY)mxY=s.points[i].y;}
      return{x:mnX,y:mnY,w:mxX-mnX,h:mxY-mnY};
    }
    if (s.type==='text'){var m=measureText(s);return{x:s.x,y:s.y,w:m.w,h:s.fontSize*1.2};}
    return{x:0,y:0,w:0,h:0};
  }

  function measureText(s) {
    ctx.save(); ctx.font=s.fontSize+'px '+getComputedStyle(document.body).fontFamily;
    var w=Math.max(ctx.measureText(s.text||'').width,20); ctx.restore(); return{w:w};
  }

  // ── History ──
  function saveHistory() {
    history=history.slice(0,historyIdx+1); history.push(JSON.parse(JSON.stringify(shapes)));
    if(history.length>MAX_HISTORY)history.shift(); historyIdx=history.length-1; updateUndoRedoState();
  }
  function undo() { if(historyIdx>0){historyIdx--;shapes=JSON.parse(JSON.stringify(history[historyIdx]));selectedIdx=-1;updateUndoRedoState();render();} }
  function redo() { if(historyIdx<history.length-1){historyIdx++;shapes=JSON.parse(JSON.stringify(history[historyIdx]));selectedIdx=-1;updateUndoRedoState();render();} }
  function updateUndoRedoState() {
    document.getElementById('wb-undo').style.opacity=historyIdx>0?'1':'0.35';
    document.getElementById('wb-redo').style.opacity=historyIdx<history.length-1?'1':'0.35';
  }
  function clearCanvas() { if(!shapes.length)return; shapes=[]; selectedIdx=-1; saveHistory(); render(); }

  // ── Rendering ──
  function render() {
    if (!canvas.width) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(offset.x, offset.y);
    ctx.scale(scale, scale);
    drawGrid();
    for (var i = 0; i < shapes.length; i++) drawShape(shapes[i]);
    if (currentShape) drawShape(currentShape);
    if (selectedIdx >= 0) drawSelectionHandles(shapes[selectedIdx]);
    ctx.restore();
    var zd = document.getElementById('wb-zoom-display');
    if (zd) zd.textContent = Math.round(scale * 100) + '%';
  }

  function drawGrid() {
    var gridSize = 25, dotSize = 1;
    var left = -offset.x / scale, top = -offset.y / scale;
    var right = (canvas.width - offset.x) / scale, bottom = (canvas.height - offset.y) / scale;
    var startX = Math.floor(left / gridSize) * gridSize, startY = Math.floor(top / gridSize) * gridSize;
    var style = getComputedStyle(document.documentElement);
    ctx.fillStyle = style.getPropertyValue('--wb-grid-color').trim() || 'rgba(255,255,255,0.06)';
    for (var x = startX; x <= right; x += gridSize) {
      for (var y = startY; y <= bottom; y += gridSize) {
        ctx.beginPath(); ctx.arc(x, y, dotSize, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function drawShape(s) {
    ctx.save();
    ctx.lineWidth = s.strokeWidth || 2;
    ctx.strokeStyle = s.stroke || '#ffffff';
    ctx.fillStyle = s.fill || 'transparent';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    switch (s.type) {
      case 'rect':
        if (s.fill && s.fill !== 'transparent') ctx.fillRect(s.x, s.y, s.w, s.h);
        ctx.strokeRect(s.x, s.y, s.w, s.h);
        break;
      case 'ellipse':
        ctx.beginPath();
        ctx.ellipse(s.x+s.w/2, s.y+s.h/2, Math.abs(s.w)/2||1, Math.abs(s.h)/2||1, 0, 0, Math.PI*2);
        if (s.fill && s.fill !== 'transparent') ctx.fill(); ctx.stroke();
        break;
      case 'diamond':
        ctx.beginPath(); var dmx=s.x+s.w/2, dmy=s.y+s.h/2;
        ctx.moveTo(dmx,s.y); ctx.lineTo(s.x+s.w,dmy); ctx.lineTo(dmx,s.y+s.h); ctx.lineTo(s.x,dmy); ctx.closePath();
        if (s.fill && s.fill !== 'transparent') ctx.fill(); ctx.stroke();
        break;
      case 'line':
        ctx.beginPath(); ctx.moveTo(s.x1,s.y1); ctx.lineTo(s.x2,s.y2); ctx.stroke();
        break;
      case 'arrow':
        ctx.beginPath(); ctx.moveTo(s.x1,s.y1); ctx.lineTo(s.x2,s.y2); ctx.stroke();
        drawArrowHead(s.x1,s.y1,s.x2,s.y2,s.strokeWidth);
        break;
      case 'pen':
        if (s.points.length < 2) break;
        ctx.beginPath(); ctx.moveTo(s.points[0].x, s.points[0].y);
        if (s.points.length === 2) { ctx.lineTo(s.points[1].x, s.points[1].y); }
        else {
          for (var i=1; i<s.points.length-1; i++) {
            var xc=(s.points[i].x+s.points[i+1].x)/2, yc=(s.points[i].y+s.points[i+1].y)/2;
            ctx.quadraticCurveTo(s.points[i].x, s.points[i].y, xc, yc);
          }
          ctx.lineTo(s.points[s.points.length-1].x, s.points[s.points.length-1].y);
        }
        ctx.stroke();
        break;
      case 'text':
        ctx.font = s.fontSize+'px '+getComputedStyle(document.body).fontFamily;
        ctx.fillStyle = s.color || '#ffffff'; ctx.textBaseline = 'top';
        var lines = (s.text||'').split('\n');
        for (var j=0; j<lines.length; j++) ctx.fillText(lines[j], s.x, s.y + j*s.fontSize*1.2);
        break;
      case 'sticky':
        ctx.shadowColor='rgba(0,0,0,0.25)'; ctx.shadowBlur=10; ctx.shadowOffsetX=2; ctx.shadowOffsetY=4;
        ctx.fillStyle = s.bgColor || '#fef08a';
        roundRect(ctx, s.x, s.y, s.w, s.h, 4); ctx.fill();
        ctx.shadowColor='transparent';
        ctx.fillStyle='rgba(0,0,0,0.08)';
        ctx.beginPath(); ctx.moveTo(s.x+s.w-20,s.y); ctx.lineTo(s.x+s.w,s.y); ctx.lineTo(s.x+s.w,s.y+20); ctx.closePath(); ctx.fill();
        ctx.fillStyle=darkenColor(s.bgColor||'#fef08a',0.1);
        ctx.beginPath(); ctx.moveTo(s.x+s.w-20,s.y); ctx.lineTo(s.x+s.w-20,s.y+20); ctx.lineTo(s.x+s.w,s.y+20); ctx.closePath(); ctx.fill();
        if (s.text) { ctx.fillStyle='#333'; ctx.font='14px '+getComputedStyle(document.body).fontFamily; ctx.textBaseline='top'; wrapText(ctx,s.text,s.x+8,s.y+8,s.w-16,18); }
        break;
    }
    ctx.restore();
  }

  function drawArrowHead(x1,y1,x2,y2,sw) {
    var angle=Math.atan2(y2-y1,x2-x1), headLen=Math.max(12,sw*4);
    ctx.save(); ctx.fillStyle=ctx.strokeStyle; ctx.beginPath(); ctx.moveTo(x2,y2);
    ctx.lineTo(x2-headLen*Math.cos(angle-Math.PI/7), y2-headLen*Math.sin(angle-Math.PI/7));
    ctx.lineTo(x2-headLen*Math.cos(angle+Math.PI/7), y2-headLen*Math.sin(angle+Math.PI/7));
    ctx.closePath(); ctx.fill(); ctx.restore();
  }

  function drawSelectionHandles(s) {
    var handles=getHandles(s), size=5/scale, bbox=getBBox(s);
    ctx.save(); ctx.strokeStyle='#4a9eff'; ctx.lineWidth=1.5/scale;
    ctx.setLineDash([6/scale,4/scale]); ctx.strokeRect(bbox.x,bbox.y,bbox.w,bbox.h); ctx.setLineDash([]);
    ctx.fillStyle='#ffffff'; ctx.strokeStyle='#4a9eff'; ctx.lineWidth=2/scale;
    for (var i=0;i<handles.length;i++) { ctx.fillRect(handles[i].x-size,handles[i].y-size,size*2,size*2); ctx.strokeRect(handles[i].x-size,handles[i].y-size,size*2,size*2); }
    ctx.restore();
  }

  // ── Utility ──
  function roundRect(c,x,y,w,h,r) {
    c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);c.lineTo(x+w,y+h-r);
    c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);c.lineTo(x,y+r);
    c.quadraticCurveTo(x,y,x+r,y);c.closePath();
  }
  function wrapText(c,text,x,y,maxW,lh) {
    var words=text.split(' '),line='',ty=y;
    for(var i=0;i<words.length;i++){var test=line+words[i]+' ';if(c.measureText(test).width>maxW&&i>0){c.fillText(line,x,ty);line=words[i]+' ';ty+=lh;}else line=test;}
    c.fillText(line,x,ty);
  }
  function darkenColor(hex,amount) {
    var r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
    r=Math.max(0,Math.floor(r*(1-amount)));g=Math.max(0,Math.floor(g*(1-amount)));b=Math.max(0,Math.floor(b*(1-amount)));
    return '#'+r.toString(16).padStart(2,'0')+g.toString(16).padStart(2,'0')+b.toString(16).padStart(2,'0');
  }
  function simplifyPoints(points,tolerance) {
    if(points.length<=2)return points;
    var maxDist=0,maxIdx=0,first=points[0],last=points[points.length-1];
    for(var i=1;i<points.length-1;i++){var d=perpDist(points[i],first,last);if(d>maxDist){maxDist=d;maxIdx=i;}}
    if(maxDist>tolerance){var l=simplifyPoints(points.slice(0,maxIdx+1),tolerance),r=simplifyPoints(points.slice(maxIdx),tolerance);return l.slice(0,-1).concat(r);}
    return[first,last];
  }
  function perpDist(pt,a,b) {
    var dx=b.x-a.x,dy=b.y-a.y,lenSq=dx*dx+dy*dy;
    if(lenSq===0)return Math.hypot(pt.x-a.x,pt.y-a.y);
    var t=Math.max(0,Math.min(1,((pt.x-a.x)*dx+(pt.y-a.y)*dy)/lenSq));
    return Math.hypot(pt.x-(a.x+t*dx),pt.y-(a.y+t*dy));
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
