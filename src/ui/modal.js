import { autoTaggingConfig, tagTemplates, regexTemplates, keywordTemplates, saveState, variableConfigs, codeBlocks, quickTaggingSelection, setQuickTaggingSelection, quickTaggingTemplates, setQuickTaggingTemplates } from '../state.js';
import { escapeHTML, escapeRegExp, sanitizeId, getDisplayVariableName } from '../utils.js';
import { populateOptionsFor, textInputHistory } from './variable-fields.js';
import { triggerResultGeneration } from '../core.js';
import { getEditorInstance } from './editor.js';

let targetInputElement = null;
let modalHistory = [];
let resizeObserver;
let quickTaggingTargets = []; // [추가] 퀵 태깅 대상 변수들을 저장할 배열

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
// [추가] 정규식 템플릿 관리 버튼
const saveRegexTemplateBtn = document.getElementById('saveRegexTemplateBtn');
const deleteRegexTemplateBtn = document.getElementById('deleteRegexTemplateBtn');
// [추가] 키워드 템플릿 UI 요소
const keywordTemplateSelect = document.getElementById('keywordTemplateSelect');
const saveKeywordTemplateBtn = document.getElementById('saveKeywordTemplateBtn');
const deleteKeywordTemplateBtn = document.getElementById('deleteKeywordTemplateBtn');
// [수정] 퀵 태깅 템플릿 UI 요소를 모듈 스코프로 이동
const quickTaggingTemplateSelect = document.getElementById('quickTaggingTemplateSelect');
const deleteQuickTaggingTemplateBtn = document.getElementById('deleteQuickTaggingTemplateBtn');
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

    fullTextDisplay.innerText = newText; // [보안 수정] XSS 방지를 위해 textContent 대신 innerText 사용
    modalHistory.push(newText);
    if (!newText) {
        fullTextDisplay.setAttribute('data-placeholder', '(비어 있음)');
    } else {
        fullTextDisplay.removeAttribute('data-placeholder');
    }
    undoBtn.disabled = false;

    // [추가] 퀵 태깅으로 변경된 내용을 각 변수에 다시 적용
    if (quickTaggingTargets.length > 0) { // 퀵 태깅 모드
        applyQuickTaggingChanges(newText);
    } else if (targetInputElement) { // 일반 태깅 모드
        targetInputElement.value = newText;
        targetInputElement.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

function handleUndo() {
    if (modalHistory.length <= 1) return;
    modalHistory.pop();
    const previousText = modalHistory[modalHistory.length - 1];
    fullTextDisplay.innerText = previousText; // [보안 수정] XSS 방지를 위해 textContent 대신 innerText 사용
    if (!previousText) {
        fullTextDisplay.setAttribute('data-placeholder', '(비어 있음)');
    } else {
        fullTextDisplay.removeAttribute('data-placeholder');
    }
    if (modalHistory.length <= 1) undoBtn.disabled = true;

    // [추가] 퀵 태깅 되돌리기도 각 변수에 다시 적용
    if (quickTaggingTargets.length > 0) { // 퀵 태깅 모드
        applyQuickTaggingChanges(previousText);
    } else if (targetInputElement) { // 일반 태깅 모드
        targetInputElement.value = previousText;
        targetInputElement.dispatchEvent(new Event('input', { bubbles: true }));
    }
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
    // [수정] 퀵 태깅과 일반 태깅을 구분하여 처리
    if (Array.isArray(inputElement)) { // 퀵 태깅의 경우
        quickTaggingTargets = inputElement;
        targetInputElement = null; // 일반 targetInputElement는 사용하지 않음
    } else { // 일반 태깅의 경우
        quickTaggingTargets = [];
        targetInputElement = inputElement;
    }
    
    let initialText, initialHtml;
    if (Array.isArray(inputElement)) { // 퀵 태깅
        initialHtml = getCombinedTextFromQuickTagTargets();
        fullTextDisplay.innerHTML = initialHtml;
        initialText = fullTextDisplay.innerText; // HTML에서 텍스트만 추출
    } else { // 일반 태깅
        initialText = inputElement.value;
        fullTextDisplay.innerText = initialText;
    }
    modalHistory = [initialText]; // 히스토리에는 순수 텍스트만 저장

    undoBtn.disabled = true;
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
    if (!initialText) {
        fullTextDisplay.setAttribute('data-placeholder', '(비어 있음)');
    } else {
        fullTextDisplay.removeAttribute('data-placeholder');
    }

    populateTagTemplates();
    populateRegexTemplates(); // [추가] 정규식 템플릿 목록 채우기
    populateKeywordTemplates(); // [추가] 키워드 템플릿 목록 채우기

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

/**
 * [추가] 퀵 태깅 대상 변수들의 값을 구분자와 함께 합칩니다.
 * @returns {string} 합쳐진 텍스트
 */
function getCombinedTextFromQuickTagTargets() {
    // [수정] 사용자가 구분자를 편집하지 못하도록 contenteditable="false" 속성을 추가합니다.
    // innerText로 값을 읽을 때 이 태그는 무시되므로, applyQuickTaggingChanges의 split 로직은 그대로 작동합니다.
    const separator = `\n\n<span contenteditable="false" style="display:block;text-align:center;color:var(--hint-color);user-select:none;">---</span>\n\n`;
    return quickTaggingTargets
        .map(varName => escapeHTML(variableConfigs[varName].default)) // [수정] 변수 값에 HTML이 포함될 수 있으므로 이스케이프 처리
        .join(separator);
}

/**
 * [추가] 퀵 태깅 모달에서 변경된 전체 텍스트를 각 변수에 다시 분배하여 적용합니다.
 * @param {string} combinedText - 커스텀 태그 모달에서 변경된 전체 텍스트
 */
function applyQuickTaggingChanges(combinedText) {
    // [수정] innerText로 읽어온 텍스트에는 span 태그가 없으므로, 구분자를 텍스트 기준으로 변경합니다.
    // 사용자가 구분자를 직접 입력하더라도, contenteditable=false 때문에 편집이 불가능합니다.
    const separatorRegex = /\n\n---\n\n/g;
    const parts = combinedText.split(separatorRegex);

    if (parts.length !== quickTaggingTargets.length) {
        console.warn('Quick tagging text parts do not match target count. Aborting update.');
        return;
    }

    let changed = false;
    quickTaggingTargets.forEach((varName, index) => {
        if (variableConfigs[varName].default !== parts[index]) {
            variableConfigs[varName].default = parts[index];
            
            // '변수 설정' UI의 textarea 값도 업데이트
            const textarea = document.getElementById(sanitizeId(varName) + '_text');
            if (textarea) {
                textarea.value = parts[index];
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
            }
            changed = true;
        }
    });

    if (changed) {
        triggerResultGeneration();
    }
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
 * [추가] 퀵 커스텀 태깅 모달의 이벤트 리스너를 설정합니다.
 */
export function setupQuickTaggingModal() {
    const modal = document.getElementById('quickTaggingModal');
    const openBtn = document.getElementById('quick-tagging-btn');
    const closeBtn = document.getElementById('quickTaggingModalCloseBtn');
    const listContainer = document.getElementById('quickTaggingVariableList');
    const selectAllBtn = document.getElementById('quickTaggingSelectAllBtn');
    const openCustomModalBtn = document.getElementById('quickTaggingOpenModalBtn');


    // [수정] blockVarNames를 함수 스코프로 이동하여 renderQuickTagItem에서 접근할 수 있도록 합니다.
    let blockVarNames = new Set();

    openBtn.addEventListener('click', () => {
        listContainer.innerHTML = '';
        // [수정] '변수 설정'의 현재 정렬 순서를 가져와 텍스트 변수만 필터링합니다.
        const sortedVariableNames = Array.from(document.querySelectorAll('#variableFields > .field, #variableFields .variable-group .field'))
            .map(el => el.id.replace('var-field-', ''))
            .map(sanitizedId => {
                // 거꾸로 원래 이름을 찾아야 합니다.
                return Object.keys(variableConfigs).find(name => `id_${Array.from(name).map(char => char.charCodeAt(0).toString(16)).join('')}` === sanitizedId);
            })
            .filter(name => name && variableConfigs[name]?.mode === 'text');

        // [추가] 코드 블록 변수와 일반 변수를 분류합니다.
        blockVarNames.clear(); // 모달을 열 때마다 초기화
        const tpl = getEditorInstance()?.getValue() || '';
        const blockInstanceRegex = /<!-- START: (.+?) -->/g;
        let match;
        while ((match = blockInstanceRegex.exec(tpl)) !== null) {
            const instanceId = match[1];
            const varRegex = new RegExp(`{{\\s*(${escapeHTML(instanceId)}_[^\\s{}]+)\\s*}}`, 'g');
            let varMatch;
            while ((varMatch = varRegex.exec(tpl)) !== null) {
                blockVarNames.add(varMatch[1]);
            }
        }

        const regularVars = sortedVariableNames.filter(name => !blockVarNames.has(name));
        const blockVars = sortedVariableNames.filter(name => blockVarNames.has(name));

        // [추가] 중복된 표시 이름을 가진 변수들을 찾아 색상을 할당합니다.
        const duplicateColorMap = {};
        const displayNameCounts = {};
        sortedVariableNames.forEach(name => {
            const displayName = getDisplayVariableName(name, blockVarNames);
            displayNameCounts[displayName] = (displayNameCounts[displayName] || 0) + 1;
        });

        const duplicateDisplayNames = Object.keys(displayNameCounts).filter(name => displayNameCounts[name] > 1);
        if (duplicateDisplayNames.length > 0) {
            const colors = ['#e11d48', '#db2777', '#9333ea', '#6d28d9', '#4f46e5', '#2563eb', '#0284c7', '#0d9488', '#15803d', '#65a30d', '#ca8a04', '#d97706', '#ea580c'];
            let colorIndex = 0;
            duplicateDisplayNames.forEach(displayName => {
                const duplicates = sortedVariableNames
                    .filter(fullName => getDisplayVariableName(fullName, blockVarNames) === displayName);
                duplicates.slice(1).forEach(fullName => {
                    duplicateColorMap[fullName] = colors[colorIndex % colors.length];
                    colorIndex++;
                });
            });
        }

        if (regularVars.length === 0 && blockVars.length === 0) {
            listContainer.innerHTML = '<p class="hint">태그를 적용할 텍스트 변수가 없습니다.</p>';
        } else {
            // 일반 변수 렌더링
            regularVars.forEach(name => renderQuickTagItem(name, listContainer, duplicateColorMap[name]));

            if (regularVars.length > 0 && blockVars.length > 0) {
                const divider = document.createElement('div');
                divider.className = 'quick-menu-divider'; // 퀵 메뉴 스타일 재사용
                listContainer.appendChild(divider);
            }

            // 코드 블록 변수를 인스턴스별로 그룹화하여 렌더링
            const groupedBlockVars = new Map();
            blockVars.forEach(name => {
                const instanceId = name.substring(0, name.lastIndexOf('_'));
                if (!groupedBlockVars.has(instanceId)) {
                    groupedBlockVars.set(instanceId, []);
                }
                groupedBlockVars.get(instanceId).push(name);
            });

            groupedBlockVars.forEach((vars, instanceId) => {
                const blockId = instanceId.split('_instance_')[0];
                const blockName = codeBlocks[blockId]?.name || blockId;

                const parts = instanceId.match(/^(block_\d+)_instance_(\d+)$/);
                let blockIdTag = `#${escapeHTML(instanceId)}`;
                let instanceIdTag = '';
                if (parts) {
                    blockIdTag = `#b${parts[1].replace('block_', '')}`;
                    instanceIdTag = `<span class="instance-id-tag">#i${parts[2]}</span>`;
                }

                const groupHeader = document.createElement('div');
                groupHeader.className = 'quick-menu-group-header'; // 퀵 메뉴 스타일 재사용
                // [수정] 그룹 헤더에 블록 ID와 인스턴스 ID 태그를 추가합니다.
                groupHeader.innerHTML = `코드 블록: ${escapeHTML(blockName)} <span class="instance-id-tag">${blockIdTag}</span>${instanceIdTag}`;
                listContainer.appendChild(groupHeader);

                vars.forEach(name => renderQuickTagItem(name, listContainer, duplicateColorMap[name]));
            });
        }
        populateQuickTaggingTemplates();
        listContainer.dispatchEvent(new Event('change', { bubbles: true })); // [수정] 모달 열 때 버튼 상태 갱신
        modal.classList.add('is-visible');
    });

    /**
     * [추가] 퀵 태깅 모달에 표시될 개별 변수 아이템을 생성하고 렌더링합니다.
     * @param {string} name - 변수 이름
     * @param {HTMLElement} container - 아이템을 추가할 부모 컨테이너
     * @param {string|undefined} duplicateColor - 중복 하이라이트 색상
     */
    function renderQuickTagItem(name, container, duplicateColor) {
        // [추가] 저장된 선택 상태를 확인합니다.
        const isChecked = quickTaggingSelection.includes(name);

        const id = `quick-tag-check-${sanitizeId(name)}`;
        const item = document.createElement('div');
        item.className = 'quick-tagging-item';
        item.dataset.varName = name;

        // [추가] 중복 이름 하이라이트 적용
        if (duplicateColor) {
            item.classList.add('duplicate-variable-highlight');
            item.style.setProperty('--duplicate-color', duplicateColor);
        }

        item.innerHTML = `
                    <div class="custom-checkbox">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </div>
                    <div class="label-container">
                        <label>${getDisplayVariableName(name, blockVarNames)}</label>
                    </div>
                    <input type="checkbox" id="${id}" value="${name}" class="visually-hidden" ${isChecked ? 'checked' : ''}>
                `;
        container.appendChild(item);

        // [추가] 저장된 상태에 따라 초기 클래스를 설정합니다.
        if (isChecked) {
            item.classList.add('is-checked');
        }

        const label = item.querySelector('label');
        let scrollAnimation;

        item.addEventListener('mouseenter', () => {
            if (label.scrollWidth > label.clientWidth) {
                const scrollAmount = label.scrollWidth - label.clientWidth;
                const duration = scrollAmount * 20;
                scrollAnimation = label.animate([
                    { transform: 'translateX(0)' },
                    { transform: `translateX(-${scrollAmount}px)`, offset: 0.8 },
                    { transform: `translateX(-${scrollAmount}px)`, offset: 1 }
                ], {
                    duration: duration + 3000,
                    delay: 500,
                    iterations: Infinity,
                    easing: 'ease-in-out'
                });
            }
        });

        item.addEventListener('mouseleave', () => {
            if (scrollAnimation) scrollAnimation.cancel();
        });

        item.addEventListener('click', () => {
            const checkbox = item.querySelector('input[type="checkbox"]');
            checkbox.checked = !checkbox.checked;
            item.classList.toggle('is-checked', checkbox.checked);
            container.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }

    closeBtn.addEventListener('click', () => modal.classList.remove('is-visible'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('is-visible'); });

    listContainer.addEventListener('change', () => {
        const selected = listContainer.querySelectorAll('input[type="checkbox"]:checked');
        openCustomModalBtn.disabled = selected.length === 0;

        // [추가] 선택 상태가 변경될 때마다 상태를 저장합니다.
        const newSelection = Array.from(selected).map(cb => cb.value);
        setQuickTaggingSelection(newSelection);
        saveState();
    });

    selectAllBtn.addEventListener('click', () => {
        const checkboxes = listContainer.querySelectorAll('input[type="checkbox"]');
        const shouldSelectAll = Array.from(checkboxes).some(cb => !cb.checked);
        
        checkboxes.forEach(cb => {
            cb.checked = shouldSelectAll;
            cb.closest('.quick-tagging-item').classList.toggle('is-checked', shouldSelectAll);
        });

        openCustomModalBtn.disabled = !shouldSelectAll;
        listContainer.dispatchEvent(new Event('change', { bubbles: true })); // [추가] 변경 이벤트를 트리거하여 상태를 저장합니다.
    });

    openCustomModalBtn.addEventListener('click', () => {
        const selectedVariables = Array.from(listContainer.querySelectorAll('input[type="checkbox"]:checked'))
            .map(cb => cb.value);
        
        if (selectedVariables.length > 0) {
            openCustomTagModal(selectedVariables);
            modal.classList.remove('is-visible');
        }
    });
}
/**
 * [추가] 저장된 퀵 태깅 템플릿으로 select 요소를 채웁니다.
 */
function populateQuickTaggingTemplates() {
    quickTaggingTemplateSelect.innerHTML = quickTaggingTemplates.length === 0 ? '<option value="">저장된 템플릿 없음</option>' : '<option value="">템플릿 선택...</option>';
    quickTaggingTemplates.forEach((tpl, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = tpl.name;
        quickTaggingTemplateSelect.appendChild(option);
    });
    deleteQuickTaggingTemplateBtn.disabled = true;
}

/**
 * [추가] 퀵 태깅 템플릿 저장/삭제/적용 이벤트 리스너를 설정합니다.
 */
function setupQuickTaggingTemplateControls() {
    const listContainer = document.getElementById('quickTaggingVariableList');
    // [수정] UI 요소 변수를 이 함수 내에서 선언합니다.
    const templateSelect = quickTaggingTemplateSelect; // 모듈 스코프 변수 사용
    const saveTemplateBtn = document.getElementById('saveQuickTaggingTemplateBtn');
    const deleteTemplateBtn = document.getElementById('deleteQuickTaggingTemplateBtn');

    saveTemplateBtn.addEventListener('click', () => {
        const name = prompt('이 선택 템플릿의 이름을 입력하세요:');
        if (!name || !name.trim()) return;
        quickTaggingTemplates.push({ name: name.trim(), selection: quickTaggingSelection });
        setQuickTaggingTemplates(quickTaggingTemplates);
        saveState();
        populateQuickTaggingTemplates();
    });

    templateSelect.addEventListener('change', (e) => {
        const selectedTpl = quickTaggingTemplates[e.target.value];
        deleteTemplateBtn.disabled = !selectedTpl;
        if (selectedTpl) {
            setQuickTaggingSelection(selectedTpl.selection);
            // UI 업데이트
            listContainer.querySelectorAll('.quick-tagging-item').forEach(item => {
                const checkbox = item.querySelector('input[type="checkbox"]');
                const isChecked = selectedTpl.selection.includes(checkbox.value);
                checkbox.checked = isChecked;
                item.classList.toggle('is-checked', isChecked);
            });
            listContainer.dispatchEvent(new Event('change', { bubbles: true })); // 상태 저장 및 버튼 활성화
        }
    });

    deleteTemplateBtn.addEventListener('click', () => {
        const selectedIndex = templateSelect.value;
        if (selectedIndex === '' || !quickTaggingTemplates[selectedIndex]) return;
        if (confirm(`'${quickTaggingTemplates[selectedIndex].name}' 템플릿을 정말 삭제하시겠습니까?`)) {
            quickTaggingTemplates.splice(selectedIndex, 1);
            setQuickTaggingTemplates(quickTaggingTemplates);
            saveState();
            populateQuickTaggingTemplates();
        }
    });
}

/**
 * [추가] 저장된 정규식 템플릿으로 select 요소를 채웁니다.
 */
function populateRegexTemplates() {
    regexTemplateSelect.innerHTML = regexTemplates.length === 0 ? '<option value="">저장된 템플릿 없음</option>' : '<option value="">템플릿 선택...</option>';
    regexTemplates.forEach((tpl, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = tpl.name;
        regexTemplateSelect.appendChild(option);
    });
    deleteRegexTemplateBtn.disabled = true; // 목록을 다시 채울 때 항상 비활성화
}

/**
 * [추가] 정규식 템플릿 저장/삭제 이벤트 리스너를 설정합니다.
 */
function setupRegexTemplateControls() {
    saveRegexTemplateBtn.addEventListener('click', () => {
        const name = prompt('이 정규식 템플릿의 이름을 입력하세요:');
        if (!name || !name.trim()) return;
        regexTemplates.push({ name: name.trim(), pattern: regexPatternInput.value, flags: regexFlagsInput.value });
        saveState();
        populateRegexTemplates();
    });

    regexTemplateSelect.addEventListener('change', (e) => {
        const selectedTpl = regexTemplates[e.target.value];
        regexPatternInput.value = selectedTpl ? selectedTpl.pattern : '';
        regexFlagsInput.value = selectedTpl ? selectedTpl.flags : 'g';
        deleteRegexTemplateBtn.disabled = !selectedTpl;
    });

    deleteRegexTemplateBtn.addEventListener('click', () => {
        const selectedIndex = regexTemplateSelect.value;
        if (selectedIndex === '' || !regexTemplates[selectedIndex]) return;
        if (confirm(`'${regexTemplates[selectedIndex].name}' 템플릿을 정말 삭제하시겠습니까?`)) {
            regexTemplates.splice(selectedIndex, 1);
            saveState();
            populateRegexTemplates();
        }
    });
}

/**
 * [추가] 저장된 키워드 템플릿으로 select 요소를 채웁니다.
 */
function populateKeywordTemplates() {
    keywordTemplateSelect.innerHTML = keywordTemplates.length === 0 ? '<option value="">저장된 템플릿 없음</option>' : '<option value="">템플릿 선택...</option>';
    keywordTemplates.forEach((tpl, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = tpl.name;
        keywordTemplateSelect.appendChild(option);
    });
    deleteKeywordTemplateBtn.disabled = true;
}

/**
 * [추가] 키워드 템플릿 저장/삭제 이벤트 리스너를 설정합니다.
 */
function setupKeywordTemplateControls() {
    saveKeywordTemplateBtn.addEventListener('click', () => {
        const name = prompt('이 키워드 템플릿의 이름을 입력하세요:');
        if (!name || !name.trim()) return;
        keywordTemplates.push({ name: name.trim(), keywords: keywordsInput.value });
        saveState();
        populateKeywordTemplates();
    });

    keywordTemplateSelect.addEventListener('change', (e) => {
        const selectedTpl = keywordTemplates[e.target.value];
        keywordsInput.value = selectedTpl ? selectedTpl.keywords : '';
        deleteKeywordTemplateBtn.disabled = !selectedTpl;
        // 키워드 입력 시 설정이 바로 업데이트되도록 input 이벤트 트리거
        keywordsInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    deleteKeywordTemplateBtn.addEventListener('click', () => {
        const selectedIndex = keywordTemplateSelect.value;
        if (selectedIndex === '' || !keywordTemplates[selectedIndex]) return;
        if (confirm(`'${keywordTemplates[selectedIndex].name}' 템플릿을 정말 삭제하시겠습니까?`)) {
            keywordTemplates.splice(selectedIndex, 1);
            saveState();
            populateKeywordTemplates();
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
    setupQuickTaggingTemplateControls(); // [추가] 퀵 태깅 템플릿 컨트롤 설정
    setupRegexTemplateControls(); // [추가] 정규식 템플릿 컨트롤 설정
    setupKeywordTemplateControls(); // [추가] 키워드 템플릿 컨트롤 설정

    regexTemplateSelect.addEventListener('change', (e) => {
        // [수정] 이 이벤트는 더 이상 사용되지 않습니다.
        // setupRegexTemplateControls 내부의 change 이벤트 핸들러가 이 역할을 대신하며,
        // 더 이상 불필요하게 autoTaggingConfig를 업데이트하지 않습니다.
        // const [pattern, flags] = e.target.value.split('::');
        // ...
        // updateConfig();
    });

    regexPatternInput.addEventListener('input', (e) => {
        const selectedHistory = autoTaggingConfig.history.find(h => h.startsWith(e.target.value + '::'));
        if (selectedHistory) {
            regexFlagsInput.value = selectedHistory.split('::')[1] || 'g';
            updateConfig();
        }
    });
}