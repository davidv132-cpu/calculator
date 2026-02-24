let expression = '';
let justCalculated = false;

const expressionEl = document.getElementById('expression');
const resultEl = document.getElementById('result');

function appendChar(char) {
  const operators = ['+', '-', '*', '/'];

  // After a calculation, start fresh on digit/dot, or continue with operator
  if (justCalculated) {
    if (operators.includes(char)) {
      expression = resultEl.textContent;
    } else {
      expression = '';
    }
    justCalculated = false;
  }

  // Prevent multiple operators in a row
  const lastChar = expression.slice(-1);
  if (operators.includes(char) && operators.includes(lastChar)) {
    expression = expression.slice(0, -1);
  }

  // Prevent multiple decimal points in the same number
  if (char === '.') {
    const parts = expression.split(/[\+\-\*\/]/);
    const currentPart = parts[parts.length - 1];
    if (currentPart.includes('.')) return;
  }

  expression += char;
  expressionEl.textContent = formatExpression(expression);
  resultEl.textContent = '0';
}

function clearAll() {
  expression = '';
  expressionEl.textContent = '';
  resultEl.textContent = '0';
  justCalculated = false;
}

function deleteLast() {
  if (justCalculated) {
    clearAll();
    return;
  }
  expression = expression.slice(0, -1);
  expressionEl.textContent = formatExpression(expression);
  resultEl.textContent = '0';
}

function calculate() {
  if (!expression) return;
  try {
    const value = evaluate(expression);
    expressionEl.textContent = formatExpression(expression) + ' =';
    resultEl.textContent = formatNumber(value);
    justCalculated = true;
  } catch {
    resultEl.textContent = 'Error';
    expression = '';
  }
}

// Safe expression evaluator (no eval)
function evaluate(expr) {
  const tokens = tokenize(expr);
  return parseExpression(tokens);
}

function tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    if (/\d|\./.test(expr[i])) {
      let num = '';
      while (i < expr.length && /\d|\./.test(expr[i])) num += expr[i++];
      tokens.push({ type: 'number', value: parseFloat(num) });
    } else if (['+', '-', '*', '/'].includes(expr[i])) {
      tokens.push({ type: 'operator', value: expr[i++] });
    } else {
      i++;
    }
  }
  return tokens;
}

// Recursive descent parser respecting operator precedence
function parseExpression(tokens) {
  let pos = 0;

  function parsePrimary() {
    const token = tokens[pos++];
    if (!token || token.type !== 'number') throw new Error('Expected number');
    return token.value;
  }

  function parseTerm() {
    let left = parsePrimary();
    while (pos < tokens.length && ['*', '/'].includes(tokens[pos].value)) {
      const op = tokens[pos++].value;
      const right = parsePrimary();
      if (op === '*') left *= right;
      else if (op === '/') {
        if (right === 0) throw new Error('Division by zero');
        left /= right;
      }
    }
    return left;
  }

  function parseSum() {
    let left = parseTerm();
    while (pos < tokens.length && ['+', '-'].includes(tokens[pos].value)) {
      const op = tokens[pos++].value;
      const right = parseTerm();
      if (op === '+') left += right;
      else left -= right;
    }
    return left;
  }

  return parseSum();
}

function formatExpression(expr) {
  return expr.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
}

function formatNumber(num) {
  if (!isFinite(num)) return 'Error';
  // Avoid floating point noise
  const rounded = parseFloat(num.toPrecision(12));
  return rounded.toString();
}

// Theme switcher
function setTheme(theme) {
  if (theme === 'dark') {
    document.body.removeAttribute('data-theme');
  } else {
    document.body.setAttribute('data-theme', theme);
  }
  localStorage.setItem('calcTheme', theme);
}

// Restore saved theme on load
(function () {
  const saved = localStorage.getItem('calcTheme');
  if (saved) {
    setTheme(saved);
    const sel = document.getElementById('themeSelect');
    if (sel) sel.value = saved;
  }
})();

// Keyboard support
document.addEventListener('keydown', (e) => {
  if (e.key >= '0' && e.key <= '9') appendChar(e.key);
  else if (e.key === '.') appendChar('.');
  else if (e.key === '+') appendChar('+');
  else if (e.key === '-') appendChar('-');
  else if (e.key === '*') appendChar('*');
  else if (e.key === '/') { e.preventDefault(); appendChar('/'); }
  else if (e.key === 'Enter' || e.key === '=') calculate();
  else if (e.key === 'Backspace') deleteLast();
  else if (e.key === 'Escape') clearAll();
});
