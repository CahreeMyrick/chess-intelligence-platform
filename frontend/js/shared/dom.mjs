/**
 * Returns a required element or fails during application startup.
 * Failing early is preferable to producing a later, unrelated null error.
 */
export function requireElement(id, root = document) {
  const element = root.getElementById(id);
  if (!element) {
    throw new Error(`Required DOM element #${id} was not found.`);
  }
  return element;
}

export function clearElement(element) {
  element.replaceChildren();
}

export function setVisible(element, visible, displayValue = '') {
  element.style.display = visible ? displayValue : 'none';
}

export function createElement(tagName, { className = '', text = '' } = {}) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== '') element.textContent = String(text);
  return element;
}
