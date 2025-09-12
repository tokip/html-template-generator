import { loadIcon } from '../utils.js';

export function updateLineNumbersFor(textareaId) {
    const textarea = document.getElementById(textareaId);
    if (!textarea) return;
    const lineNumbersDiv = textarea.previousElementSibling;
    if (!lineNumbersDiv) return;

    const lineCount = textarea.value ? textarea.value.split('\n').length : 1;

    const numbers = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');
    const lineNumbersContent = lineNumbersDiv.firstElementChild;
    if (lineNumbersContent) {
        lineNumbersContent.textContent = numbers;
    }

    const scrollbarHeight = textarea.offsetHeight - textarea.clientHeight;
    lineNumbersDiv.style.paddingBottom = `${10 + scrollbarHeight}px`;
}

export function updateCollapseUI(variableCount) {
    const wrapper = document.getElementById('variables-content-wrapper');
    const btnContainer = document.getElementById('collapse-toggle-container');
    const btn = document.getElementById('collapse-toggle-btn');

    if (!wrapper || !btnContainer || !btn) return;

    if (variableCount > 4) {
        btnContainer.style.display = 'flex';
        const isCollapsed = wrapper.classList.contains('is-collapsed');
        btn.textContent = isCollapsed ? '펼치기 ▼' : '접기 ▲';
    } else {
        btnContainer.style.display = 'none';
        wrapper.classList.remove('is-collapsed');
    }
}

export function lockBodyScroll(elements) {
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`;
        elements.forEach(el => {
            if (el) el.style.right = `${20 + scrollbarWidth}px`;
        });
    }
    document.body.classList.add('no-scroll');
}

export function unlockBodyScroll(elements) {
    document.body.classList.remove('no-scroll');
    document.body.style.paddingRight = '';
    elements.forEach(el => {
        if (el) el.style.right = '';
    });
}

/**
 * 대상 요소의 내용을 지정된 아이콘으로 교체합니다.
 * @param {HTMLElement} element - 아이콘을 삽입할 대상 요소
 * @param {string} iconName - 로드할 아이콘의 이름
 * @param {object} [options] - loadIcon에 전달할 옵션
 */
export async function setIcon(element, iconName, options = {}) {
    if (!element) return;
    const icon = await loadIcon(iconName, options);
    if (icon) {
        element.innerHTML = ''; // 기존 내용 삭제
        element.appendChild(icon);
    }
}