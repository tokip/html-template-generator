import { autoTaggingConfig, tagTemplates, saveState } from '../state.js';
import { escapeHTML, escapeRegExp } from '../utils.js';

let targetInputElement = null;
let modalHistory = [];
let resizeObserver;

const modal = document.getElementById('customTagModal');
const modalContent = modal.querySelector('.modal-content');
const modalBody = modal.querySelector('.modal-body');
const fullTextDisplay = document.getElementById('modalFullText');
const openTagInput = document.getElementById('modalOpenTag');
const closeTagInput = document.getElementById('modalCloseTag');
const insertBtn = document.getElementById('insertCustomTagBtn');
const undoBtn = document.getElementById('undoCustomTagBtn');
const modalTopCloseBtn = document.getElementById('modalTopCloseBtn');
const autoTagToggle = document.getElementById('autoTagToggle');
const exclusionInput = document.getElementById('autoTagExclusion');
const modeRadios = document.querySelectorAll('input[name="autoTagMode"]');
const keywordSettings = document.getElementById('autoTagKeywordSettings');
const regexSettings = document.getElementById('autoTagRegexSettings');
const keywordsInput = document.getElementById('autoTagKeywords');
const regexPatternInput = document.getElementById('autoTagRegexPattern');
const regexTemplateSelect = document.getElementById('regexTemplateSelect');
const regexHistoryDatalist = document.getElementById('regexHistoryDatalist');
const regexFlagsInput = document.getElementById('autoTagRegexFlags');

function closeModal() {
    modal.classList.remove('is-visible');
    insertBtn.removeEventListener('click', handleInsert);
    undoBtn.removeEventListener('click', handleUndo);
    modal.removeEventListener('keydown', handleModalKeyDown);
    document.removeEventListener('mousedown', handleDocumentMouseDown);
    modalBody.removeEventListener('scroll', updateShadows);
    if (resizeObserver) resizeObserver.disconnect();
    modalTopCloseBtn.removeEventListener('click', closeModal);
}

function updateShadows() {
    const scrollTop = modalBody.scrollTop;
    const scrollHeight = modalBody.scrollHeight;
    const clientHeight = modalBody.clientHeight;

    if (scrollHeight <= clientHeight) {
        modalBody.style.setProperty('--scroll-top-opacity', '0');
        modalBody.style.setProperty('--scroll-bottom-opacity', '0');
        return;
    }

    const topOpacity = scrollTop > 1.5 ? 1 : 0;
    const isAtBottom = clientHeight + scrollTop >= scrollHeight - 1.5;
    const bottomOpacity = isAtBottom ? 0 : 1;

    modalBody.style.setProperty('--scroll-top-opacity', topOpacity);
    modalBody.style.setProperty('--scroll-bottom-opacity', bottomOpacity);
}

function handleDocumentMouseDown(e) {
    if (!modalContent.contains(e.target)) {
        closeModal();
    }
}

function handleInsert() {
    const openTag = openTagInput.value;
    const closeTag = closeTagInput.value;
    let originalText = fullTextDisplay.textContent;
    let newText = originalText;

    if (autoTagToggle.checked) {
        const exclusions = autoTaggingConfig.exclusion.split(',').map(s => s.trim()).filter(Boolean);

        if (autoTaggingConfig.mode === 'keyword') {
            const keywords = autoTaggingConfig.keywords.split(',').map(s => s.trim()).filter(Boolean);
            if (keywords.length === 0) {
                alert('자동 태그를 적용할 키워드를 입력해주세요.');
                return;
            }

            const keywordRegex = new RegExp(`(${keywords.map(escapeRegExp).join('|')})`, 'g');
            newText = originalText.replace(keywordRegex, (match) => {
                if (exclusions.some(ex => match.includes(ex))) {
                    return match;
                }
                return `${openTag}${match}${closeTag}`;
            });

        } else { // 'regex' mode
            const pattern = autoTaggingConfig.regexPattern;
            const flags = autoTaggingConfig.regexFlags;
            if (!pattern) {
                alert('자동 태그를 적용할 정규식 패턴을 입력해주세요.');
                return;
            }
            try {
                const userRegex = new RegExp(pattern, flags);
                newText = originalText.replace(userRegex, (match) => {
                    if (exclusions.length > 0 && exclusions.some(ex => match.includes(ex))) {
                        return match;
                    }
                    return `${openTag}${match}${closeTag}`;
                });
            } catch (e) {
                alert(`잘못된 정규식입니다: ${e.message}`);
                return;
            }
            const newPattern = `${pattern}::${flags}`;
            if (!autoTaggingConfig.history.includes(newPattern)) {
                autoTaggingConfig.history.unshift(newPattern);
                autoTaggingConfig.history = autoTaggingConfig.history.slice(0, 10);
                saveState();
            }
        }
    } else { // Manual tagging
        const selection = window.getSelection();
        if (!selection.rangeCount || selection.isCollapsed) {
            alert('먼저 전체 텍스트에서 태그를 적용할 부분을 선택해주세요.');
            return;
        }
        const range = selection.getRangeAt(0);
        if (!fullTextDisplay.contains(range.commonAncestorContainer)) {
            alert('먼저 전체 텍스트에서 태그를 적용할 부분을 선택해주세요.');
            return;
        }
        const selectedText = range.toString();
        const wrappedText = openTag + selectedText + closeTag;
        range.deleteContents();
        range.insertNode(document.createTextNode(wrappedText));
        newText = fullTextDisplay.textContent;
    }

    targetInputElement.value = newText;
    targetInputElement.dispatchEvent(new Event('input', { bubbles: true }));
    fullTextDisplay.innerText = newText; // [보안 수정] XSS 방지를 위해 textContent 대신 innerText 사용
    modalHistory.push(newText);
    if (!newText) {
        fullTextDisplay.setAttribute('data-placeholder', '(비어 있음)');
    } else {
        fullTextDisplay.removeAttribute('data-placeholder');
    }
    undoBtn.disabled = false;
}

function handleUndo() {
    if (modalHistory.length <= 1) return;
    modalHistory.pop();
    const previousText = modalHistory[modalHistory.length - 1];
    targetInputElement.value = previousText;
    targetInputElement.dispatchEvent(new Event('input', { bubbles: true })); 
    fullTextDisplay.innerText = previousText; // [보안 수정] XSS 방지를 위해 textContent 대신 innerText 사용
    if (!previousText) {
        fullTextDisplay.setAttribute('data-placeholder', '(비어 있음)');
    } else {
        fullTextDisplay.removeAttribute('data-placeholder');
    }
    if (modalHistory.length <= 1) undoBtn.disabled = true;
}

function handleModalKeyDown(e) {
    if (e.key === 'Escape') {
        closeModal();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        handleUndo();
    } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleInsert();
    }
}

export function openCustomTagModal(inputElement) {
    targetInputElement = inputElement;
    modalHistory = [targetInputElement.value];

    undoBtn.disabled = true;
    fullTextDisplay.innerText = targetInputElement.value; // [보안 수정] XSS 방지를 위해 textContent 대신 innerText 사용
    autoTagToggle.checked = autoTaggingConfig.enabled;
    exclusionInput.value = autoTaggingConfig.exclusion;

    const modeRadioToSelect = document.querySelector(`input[name="autoTagMode"][value="${autoTaggingConfig.mode}"]`);
    if (modeRadioToSelect) modeRadioToSelect.checked = true;

    keywordsInput.value = autoTaggingConfig.keywords;
    regexPatternInput.value = autoTaggingConfig.regexPattern;
    regexFlagsInput.value = autoTaggingConfig.regexFlags;

    updateModeUI();

    regexHistoryDatalist.innerHTML = '';
    autoTaggingConfig.history.forEach(item => {
        regexHistoryDatalist.innerHTML += `<option value="${item.split('::')[0]}"></option>`;
    });

    insertBtn.textContent = autoTagToggle.checked ? '자동 태그 적용' : '태그 삽입';
    if (!targetInputElement.value) {
        fullTextDisplay.setAttribute('data-placeholder', '(비어 있음)');
    } else {
        fullTextDisplay.removeAttribute('data-placeholder');
    }

    populateTagTemplates();

    insertBtn.addEventListener('click', handleInsert);
    undoBtn.addEventListener('click', handleUndo);
    modal.addEventListener('keydown', handleModalKeyDown);
    modalTopCloseBtn.addEventListener('click', closeModal);
    modalBody.addEventListener('scroll', updateShadows);

    resizeObserver = new ResizeObserver(updateShadows);
    resizeObserver.observe(modalBody);

    setTimeout(() => {
        document.addEventListener('mousedown', handleDocumentMouseDown);
    }, 0);

    requestAnimationFrame(updateShadows);
    modal.classList.add('is-visible');
}

export function setupCustomTagTemplates() {
    const saveBtn = document.getElementById('saveTagTemplateBtn');
    const templateSelect = document.getElementById('tagTemplateSelect');
    const deleteBtn = document.getElementById('deleteTagTemplateBtn');

    saveBtn.addEventListener('click', () => {
        const name = prompt('이 태그 템플릿의 이름을 입력하세요:');
        if (!name || !name.trim()) return;
        tagTemplates.push({ name: name.trim(), open: openTagInput.value, close: closeTagInput.value });
        saveState();
        populateTagTemplates();
    });

    templateSelect.addEventListener('change', (e) => {
        const selectedTpl = tagTemplates[e.target.value];
        openTagInput.value = selectedTpl ? selectedTpl.open : '';
        closeTagInput.value = selectedTpl ? selectedTpl.close : '';
        deleteBtn.disabled = !selectedTpl;
    });

    deleteBtn.addEventListener('click', () => {
        const selectedIndex = templateSelect.value;
        if (selectedIndex === '' || !tagTemplates[selectedIndex]) return;
        const templateName = tagTemplates[selectedIndex].name;
        if (confirm(`'${templateName}' 템플릿을 정말 삭제하시겠습니까?`)) {
            tagTemplates.splice(selectedIndex, 1);
            saveState();
            populateTagTemplates();
            openTagInput.value = '';
            closeTagInput.value = '';
            deleteBtn.disabled = true;
        }
    });
}

function populateTagTemplates() {
    const templateSelect = document.getElementById('tagTemplateSelect');
    templateSelect.innerHTML = tagTemplates.length === 0 ? '<option value="">저장된 템플릿 없음</option>' : '<option value="">템플릿 선택...</option>';
    tagTemplates.forEach((tpl, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = tpl.name;
        templateSelect.appendChild(option);
    });
}

function updateModeUI() {
    const isKeywordMode = document.querySelector('input[name="autoTagMode"]:checked').value === 'keyword';
    keywordSettings.style.display = isKeywordMode ? 'block' : 'none';
    regexSettings.style.display = isKeywordMode ? 'none' : 'block';
}

export function setupAutoTagSettings() {
    const insertBtn = document.getElementById('insertCustomTagBtn');

    const updateConfig = () => {
        autoTaggingConfig.enabled = autoTagToggle.checked;
        autoTaggingConfig.exclusion = exclusionInput.value;
        autoTaggingConfig.mode = document.querySelector('input[name="autoTagMode"]:checked').value;
        autoTaggingConfig.keywords = keywordsInput.value;
        autoTaggingConfig.regexPattern = regexPatternInput.value;
        autoTaggingConfig.regexFlags = regexFlagsInput.value;

        insertBtn.textContent = autoTagToggle.checked ? '자동 태그 적용' : '태그 삽입';
        saveState();
    };

    [autoTagToggle, exclusionInput, keywordsInput, regexPatternInput, regexFlagsInput].forEach(el => {
        el.addEventListener('input', updateConfig);
        el.addEventListener('change', updateConfig);
    });
    modeRadios.forEach(radio => radio.addEventListener('change', () => {
        updateConfig();
        updateModeUI(); // [추가] 모드 변경 시 UI를 즉시 업데이트합니다.
    }));

    regexTemplateSelect.addEventListener('change', (e) => {
        const [pattern, flags] = e.target.value.split('::');
        if (pattern) {
            regexPatternInput.value = pattern;
            regexFlagsInput.value = flags || 'g';
            updateConfig();
        }
    });

    regexPatternInput.addEventListener('input', (e) => {
        const selectedHistory = autoTaggingConfig.history.find(h => h.startsWith(e.target.value + '::'));
        if (selectedHistory) {
            regexFlagsInput.value = selectedHistory.split('::')[1] || 'g';
            updateConfig();
        }
    });
}