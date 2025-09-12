/**
 * [추가] 코드 블록 변수 이름에서 접두사를 제거하고 순수한 변수명만 반환합니다.
 * @param {string} fullName - 전체 변수 이름 (예: block_123_instance_456_varName)
 * @param {Set<string>} [blockVarNames] - 실제 코드 블록 변수 이름의 Set. 이 값이 제공되면, fullName이 Set에 포함된 경우에만 접두사를 제거합니다.
 * @returns {string} - 순수 변수 이름 (예: varName)
 */
export function getDisplayVariableName(fullName, blockVarNames) {
    // [수정] 이름 패턴 매칭 대신, 신뢰할 수 있는 출처 정보(blockVarNames)를 기반으로 접두사를 제거합니다.
    if (blockVarNames && blockVarNames.has(fullName)) {
        const parts = fullName.split('_instance_');
        return parts.length > 1 ? parts[1].split('_').slice(1).join('_') : fullName;
    }
    return fullName;
}

export function sanitizeId(name) {
    // 한글 등 멀티바이트 문자를 안전하게 ID로 변환
    return 'id_' + Array.from(name).map(char => char.charCodeAt(0).toString(16)).join('');
}

export function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

export function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function doBeautify(html) {
    try {
        if (typeof html_beautify === 'function') return html_beautify(html, { indent_size: 2 });
    } catch (e) { console.warn('beautify failed', e); }
    return html;
}

export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

const iconCache = new Map();

/**
 * SVG 아이콘을 비동기적으로 로드하고, 클래스와 속성을 설정하여 반환합니다.
 * 한 번 로드된 아이콘은 캐시하여 재사용합니다.
 * @param {string} name - 'icons' 디렉터리 내의 SVG 파일 이름 (확장자 제외).
 * @param {object} [options] - { className: string, target: HTMLElement }. target을 지정하면 아이콘을 해당 요소에 직접 추가합니다.
 * @returns {Promise<SVGElement|null>}
 */
export async function loadIcon(name, options = {}) {
    if (iconCache.has(name)) {
        const cachedSvg = iconCache.get(name).cloneNode(true);
        if (options.className) cachedSvg.classList.add(...options.className.split(' '));
        if (options.target) options.target.appendChild(cachedSvg);
        return cachedSvg;
    }

    try {
        const response = await fetch(`./icons/${name}.svg`);
        if (!response.ok) throw new Error(`Icon not found: ${name}`);
        const svgText = await response.text();
        const div = document.createElement('div');
        div.innerHTML = svgText;
        const svgElement = div.querySelector('svg');
        if (!svgElement) return null;

        iconCache.set(name, svgElement.cloneNode(true)); // 원본을 캐시에 저장

        if (options.className) svgElement.classList.add(...options.className.split(' '));
        if (options.target) options.target.appendChild(svgElement);
        return svgElement;
    } catch (error) {
        console.error(`Failed to load icon: ${name}`, error);
        return null;
    }
}

export function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast-message ${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('is-visible');
    });

    setTimeout(() => {
        toast.remove();
    }, duration);
}