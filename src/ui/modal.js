import { autoTaggingConfig, tagTemplates, saveState, variableConfigs } from '../state.js';
import { escapeHTML, escapeRegExp } from '../utils.js';
import { populateOptionsFor, textInputHistory } from './variable-fields.js';
import { triggerResultGeneration } from '../core.js';

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
// [추가] 키워드 대체 UI 요소
const autoTagReplaceToggle = document.getElementById('autoTagReplaceToggle');
const autoTagReplaceKeywordInput = document.getElementById('autoTagReplaceKeyword');

/**
 * [추가] 텍스트 서식 툴바를 생성하고 이벤트 리스너를 연결하는 헬퍼 함수.
 * @param {HTMLTextAreaElement} inputElement - 툴바가 제어할 textarea 요소.
 * @returns {HTMLDivElement} 생성된 툴바 요소.
 */
function createFormattingToolbar(inputElement) {
    const toolbar = document.createElement('div');
    toolbar.className = 'text-format-toolbar';
    toolbar.innerHTML = `
        <button name="format-bold" data-tag="b" title="굵게 (Ctrl+B)">B</button>
        <button name="format-italic" data-tag="i" title="기울임 (Ctrl+I)">I</button>
        <button name="format-link" data-tag="a" title="링크 삽입">Link</button>
        <button name="format-custom" data-tag="custom" title="커스텀 태그">Custom</button>
    `;

    toolbar.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const tag = btn.dataset.tag;
        if (tag === 'custom') {
            openCustomTagModal(inputElement);
            return;
        }
        let attribute = '';
        if (tag === 'a') {
            const url = prompt('연결할 URL을 입력하세요:', 'https://');
            if (!url) return;
            attribute = ` href="${escapeHTML(url)}"`;
        }
        // wrapTextWithTag 함수는 variable-fields.js에 정의되어 있어야 합니다.
        // 여기서는 해당 함수가 전역적으로 접근 가능하거나, import 되었다고 가정합니다.
        // 실제로는 이 함수도 modal.js로 옮기거나 공통 유틸로 만드는 것이 좋습니다.
        const start = inputElement.selectionStart;
        const end = inputElement.selectionEnd;
        const text = inputElement.value;
        const selectedText = text.substring(start, end);
        const newText = `${text.substring(0, start)}<${tag}${attribute}>${selectedText}</${tag}>${text.substring(end)}`;
        inputElement.value = newText;
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return toolbar;
}

/**
 * [추가] textarea의 높이를 내용에 맞게 자동으로 조절하는 헬퍼 함수.
 * @param {HTMLTextAreaElement} el - 높이를 조절할 textarea 요소.
 */
function autoResizeTextarea(el) {
    // [수정] 높이를 초기화한 후 scrollHeight를 기반으로 다시 설정하여 정확한 계산을 보장합니다.
    el.style.height = 'auto';
    el.style.height = (el.scrollHeight) + 'px';
}

/**
 * [추가] 옵션 편집 모달 내에서 '이름' 또는 '값' 편집기를 생성하는 헬퍼 함수.
 * @param {string} initialValue - 편집기의 초기 텍스트 값.
 * @returns {{panel: HTMLDivElement, input: HTMLTextAreaElement}} - 생성된 패널과 textarea 참조.
 */
function createOptionEditor(initialValue) {
    const panel = document.createElement('div'); // [수정] 슬라이더를 사용하지 않으므로 클래스를 제거합니다.
    panel.className = 'option-editor-wrapper'; // [추가] 나중에 쉽게 찾아서 제거할 수 있도록 클래스를 추가합니다.
    const editorWrapper = document.createElement('div');
    editorWrapper.className = 'option-editor-content';

    const nameInput = document.createElement('textarea');
    nameInput.className = 'auto-height-textarea';
    nameInput.value = initialValue;
    nameInput.rows = 1;

    const toolbar = createFormattingToolbar(nameInput);
    editorWrapper.append(nameInput, toolbar);

    // [수정] 모달이 표시된 후 초기 높이를 계산하고, 내용이 변경될 때마다 높이를 조절합니다.
    nameInput.addEventListener('input', () => {
        autoResizeTextarea(nameInput);
    });
    // [추가] 변수 텍스트 입력 모드와 동일하게, setTimeout을 사용하여 초기 높이를 설정합니다.
    // 이렇게 하면 textarea가 DOM에 추가된 후 높이가 계산되어 정확성이 높아집니다.
    setTimeout(() => autoResizeTextarea(nameInput), 0);

    panel.appendChild(editorWrapper);

    return { panel, input: nameInput };
}

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
    const replaceEnabled = autoTaggingConfig.replaceEnabled;
    const replaceKeyword = autoTaggingConfig.replaceKeyword;
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
                return replaceEnabled ? replaceKeyword : `${openTag}${match}${closeTag}`;
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
                    return replaceEnabled ? replaceKeyword.replace('$0', match) : `${openTag}${match}${closeTag}`;
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
    autoTagReplaceToggle.checked = autoTaggingConfig.replaceEnabled;
    autoTagReplaceKeywordInput.value = autoTaggingConfig.replaceKeyword;

    const modeRadioToSelect = document.querySelector(`input[name="autoTagMode"][value="${autoTaggingConfig.mode}"]`);
    if (modeRadioToSelect) modeRadioToSelect.checked = true;

    keywordsInput.value = autoTaggingConfig.keywords;
    regexPatternInput.value = autoTaggingConfig.regexPattern;
    regexFlagsInput.value = autoTaggingConfig.regexFlags;

    updateModeUI();
    updateReplaceUI();

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

/**
 * [추가] 드롭다운 옵션 편집 모달을 열고 관리하는 함수.
 * @param {string} varName - 옵션을 포함하는 변수의 이름.
 * @param {number} optionIndex - 편집할 옵션의 인덱스.
 */
export function openEditOptionModal(varName, optionIndex) {
    const editModal = document.getElementById('editOptionModal');
    const closeBtn = document.getElementById('editOptionModalCloseBtn');
    const saveBtn = document.getElementById('saveOptionBtn');
    const toggle = document.getElementById('optionEditorToggle');
    const modalBody = editModal.querySelector('.modal-body'); // [수정] 편집기를 modal-body에 직접 추가합니다.

    const cfg = variableConfigs[varName];
    const option = cfg.options[optionIndex];
    if (!option) return;

    // [수정] 기존 편집기 내용을 지우고, '이름'과 '값' 편집기를 각각 생성합니다.
    modalBody.querySelectorAll('.option-editor-wrapper').forEach(el => el.remove()); // [수정] 이 코드가 이미 있지만, createOptionEditor에 클래스를 추가하여 이 코드가 올바르게 동작하도록 합니다.
    const { panel: namePanel, input: nameInput } = createOptionEditor(option.name);
    const { panel: valuePanel, input: valueInput } = createOptionEditor(option.value);
    namePanel.id = 'editOptionNameWrapper';
    valuePanel.id = 'editOptionValueWrapper';
    modalBody.append(namePanel, valuePanel);

    // [추가] 토글 스위치 이벤트 핸들러
    toggle.checked = false; // 기본으로 '이름'을 보여줌
    namePanel.style.display = 'block';
    valuePanel.style.display = 'none';

    const toggleHandler = () => {
        // [수정] 슬라이더 대신 display 속성을 직접 제어하여 패널을 숨기거나 표시합니다.
        const showValue = toggle.checked;
        namePanel.style.display = showValue ? 'none' : 'block';
        valuePanel.style.display = showValue ? 'block' : 'none';

        // [수정] 패널이 화면에 표시된 후(display: block)에 높이를 재계산합니다.
        // display: none 상태에서는 scrollHeight가 0으로 계산되어 높이 조절이 실패하기 때문입니다.
        if (showValue) {
            autoResizeTextarea(valueInput);
        } else {
            autoResizeTextarea(nameInput);
        }
    };
    toggle.addEventListener('change', toggleHandler);

    const closeModalHandler = () => {
        editModal.classList.remove('is-visible');
        saveBtn.removeEventListener('click', saveHandler);
        closeBtn.removeEventListener('click', closeModalHandler);
        editModal.removeEventListener('click', overlayClickHandler);
        toggle.removeEventListener('change', toggleHandler); // [추가] 이벤트 리스너 정리
    };

    const saveHandler = () => {
        const newName = nameInput.value;
        const newValue = valueInput.value;

        if (!newValue) {
            showToast('옵션 값은 비워둘 수 없습니다.', 'error');
            return;
        }

        // [수정] 값에 HTML 태그가 포함될 수 있으므로, trim()을 사용하지 않고 순수 텍스트만 비교합니다.
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = newValue;
        const newValueText = tempDiv.textContent || tempDiv.innerText || '';

        // 자기 자신을 제외하고 값이 중복되는지 확인
        if (newValue !== option.value && cfg.options.some(o => o.value === newValueText)) {
            showToast('동일한 옵션 값이 이미 존재합니다.', 'error');
            return;
        }

        // 변경 사항 적용
        option.name = newName || newValue; // 이름이 비어있으면 값으로 대체
        
        // 기본값이 변경된 값과 일치하면 기본값도 업데이트
        if (cfg.default === option.value) {
            cfg.default = newValue;
        }

        option.value = newValue;

        saveState();
        // UI 갱신
        const selElement = document.getElementById(`id_${Array.from(varName).map(char => char.charCodeAt(0).toString(16)).join('')}_select`);
        const chipsElement = document.getElementById(`id_${Array.from(varName).map(char => char.charCodeAt(0).toString(16)).join('')}_chips`);
        populateOptionsFor(varName, selElement, chipsElement, true);
        triggerResultGeneration();

        closeModalHandler();
    };

    const overlayClickHandler = (e) => {
        if (e.target === editModal) {
            closeModalHandler();
        }
    };

    saveBtn.addEventListener('click', saveHandler);
    closeBtn.addEventListener('click', closeModalHandler);
    editModal.addEventListener('click', overlayClickHandler);

    // [추가] 모달이 열릴 때 초기 활성 패널을 설정합니다.
    editModal.classList.add('is-visible');

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

function updateReplaceUI() {
    autoTagReplaceKeywordInput.style.display = autoTagReplaceToggle.checked ? 'block' : 'none';
    openTagInput.closest('div').style.display = autoTagReplaceToggle.checked ? 'none' : 'block';
    closeTagInput.closest('div').style.display = autoTagReplaceToggle.checked ? 'none' : 'block';
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
        autoTaggingConfig.replaceEnabled = autoTagReplaceToggle.checked;
        autoTaggingConfig.replaceKeyword = autoTagReplaceKeywordInput.value;

        insertBtn.textContent = autoTagToggle.checked ? '자동 태그 적용' : '태그 삽입';
        saveState();
    };

    [autoTagToggle, exclusionInput, keywordsInput, regexPatternInput, regexFlagsInput, autoTagReplaceToggle, autoTagReplaceKeywordInput].forEach(el => {
        el.addEventListener('input', updateConfig);
        el.addEventListener('change', updateConfig);
    });
    modeRadios.forEach(radio => radio.addEventListener('change', () => {
        updateConfig();
        updateModeUI(); // [추가] 모드 변경 시 UI를 즉시 업데이트합니다.
    }));
    autoTagReplaceToggle.addEventListener('change', () => {
        updateConfig();
        updateReplaceUI();
    });

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