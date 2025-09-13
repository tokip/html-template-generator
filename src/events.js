import { processTemplateAndExtractVariables, generateResult, triggerResultGeneration } from './core.js';
import { exportToJson, importFromJson, saveState, setTheme, currentTheme, variableConfigs, codeBlocks, setCodeBlocks, setVariableConfigs, setSyncGroups, setSyncColorMap, setTemplateOrder, setCurrentFilter, setCurrentSort } from './state.js';
import { doBeautify, debounce, loadIcon, showToast, escapeHTML } from './utils.js';
import { updateCollapseUI, lockBodyScroll, unlockBodyScroll, setIcon } from './ui/dom-helpers.js';
import { manageTocCollapse } from './ui/variable-fields.js';
import { renderQuickMenu, adjustQuickMenuPosition, toggleQuickMenu, setupQuickMenuInteractions } from './ui/quick-menu.js';
import { setupMaximizeMode } from './ui/maximize.js';
import { setupCustomTagTemplates, setupAutoTagSettings } from './ui/modal.js'; 
import { getEditorInstance, getResultEditorInstance } from './ui/editor.js';
import { markCodeBlocks } from './ui/editor.js';

export async function setupEventListeners(CACHED_ELEMENTS) {
    const FIXED_RIGHT_BUTTONS = [CACHED_ELEMENTS.themeToggleBtn, CACHED_ELEMENTS.scrollTopBtn];
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    let lastWindowWidth = window.innerWidth;

    // [수정] 아이콘 로드 로직을 단순화하고 중앙에서 관리합니다.
    // setIcon 함수는 내부적으로 loadIcon을 호출하며, 아이콘을 버튼 내부에 삽입합니다.
    await Promise.all([
        ...Array.from(document.querySelectorAll('button[data-icon]:not(#theme-toggle)')).map(btn => setIcon(btn, btn.dataset.icon)),
    ]);
    // [추가] 초기화 모달의 경고 아이콘을 미리 로드합니다.
    const warningIconContainer = document.getElementById('reset-warning-icon-container');
    if (warningIconContainer) await setIcon(warningIconContainer, 'alert-triangle');

    document.getElementById('extractBtn').addEventListener('click', () => {
        processTemplateAndExtractVariables(); // [수정] '변수 추출' 시에도 유효성 검사를 실행합니다.
        // [추가] 변수 추출 후, 현재 템플릿을 "저장된 상태"로 간주하고 버튼을 숨깁니다.
        window.lastSavedTemplate = getEditorInstance().getValue();
        updateExtractBtnVisibility();
    });

    document.getElementById('formatBtn').addEventListener('click', () => {
        const editor = getEditorInstance();
        editor.setValue(doBeautify(editor.getValue()));
        saveState();
    });
    document.getElementById('genBtn').addEventListener('click', generateResult);
    document.getElementById('copyBtn').addEventListener('click', copyToClipboard);
    document.getElementById('exportBtn').addEventListener('click', exportToJson);
    document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
    document.getElementById('importFile').addEventListener('change', importFromJson);

    // [수정] 이벤트 위임을 사용하여 동적으로 생성되는 삭제 버튼의 이벤트를 처리합니다.
    // 이 리스너는 한 번만 등록되어야 합니다.
    document.getElementById('variableFields').addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('.delete-block-instance-btn');
        if (deleteBtn && deleteBtn.dataset.instanceId) {
            const instanceId = deleteBtn.dataset.instanceId;
            const blockName = deleteBtn.dataset.blockName || '이';
            if (confirm(`'${blockName}' 블록 인스턴스를 템플릿에서 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) {
                deleteCodeBlockInstance(instanceId);
            }
        }
    });

    // [수정] 초기화 로직을 모달과 결합하여 재구성합니다.
    setupResetModal();

    CACHED_ELEMENTS.realtimeToggle.addEventListener('change', saveState);
    // [수정] CodeMirror 이벤트는 editor.js에서 처리합니다.

    CACHED_ELEMENTS.themeToggleBtn.addEventListener('click', () => {
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        setTheme(newTheme);
        generateResult(); // 테마 변경 후 결과 다시 생성
        saveState();
    });

    document.getElementById('collapse-toggle-btn').addEventListener('click', () => {
        CACHED_ELEMENTS.variablesContentWrapper.classList.toggle('is-collapsed');
        updateCollapseUI(Object.keys(variableConfigs).length);
    });

    // 코드 블록 이벤트 리스너
    document.getElementById('add-code-block-modal-btn').addEventListener('click', openCodeBlockModal);
    setupCodeBlockModal();

    window.addEventListener('resize', debounce(() => {
            const panel = CACHED_ELEMENTS.quickMenuPanel;
            const newWidth = window.innerWidth;
            const isCrossingToPC = lastWindowWidth <= 1024 && newWidth > 1024;
            const isCrossingToMobile = lastWindowWidth > 1024 && newWidth <= 1024;
            const isCrossingBoundary = isCrossingToPC || isCrossingToMobile;

            if (panel.classList.contains('is-open') && isCrossingBoundary) {
                panel.classList.remove('is-open');
                setTimeout(() => {
                    renderQuickMenu();
                    adjustQuickMenuPosition();
                    requestAnimationFrame(() => {
                        panel.classList.add('is-open');
                        if (newWidth <= 1024) lockBodyScroll(FIXED_RIGHT_BUTTONS);
                        else unlockBodyScroll(FIXED_RIGHT_BUTTONS);
                    });
                }, 250);

            } else if (window.innerWidth !== lastWindowWidth) {
                if (panel.classList.contains('is-open')) {
                    renderQuickMenu();
                    adjustQuickMenuPosition();
                }
                const tocElement = CACHED_ELEMENTS.variableFieldsContainer.querySelector('.toc');
                if (tocElement) manageTocCollapse(tocElement);
            }

            document.querySelectorAll('.auto-height-textarea').forEach(textarea => {
                textarea.style.height = 'auto';
                textarea.style.height = (textarea.scrollHeight) + 'px';
            });

            lastWindowWidth = newWidth;
    }, 150));

    const quickMenuToggleBtn = CACHED_ELEMENTS.quickMenuToggleBtn;
    quickMenuToggleBtn.addEventListener('click', () => toggleQuickMenu(CACHED_ELEMENTS, FIXED_RIGHT_BUTTONS));

    // [수정] 퀵 메뉴를 위한 전역 키보드 리스너를 추가합니다.
    document.addEventListener('keydown', (e) => {
        // 스페이스바를 눌렀고, 텍스트 입력 중이 아닐 때 퀵 메뉴를 토글합니다.
        if (e.key === ' ') {
            const activeEl = document.activeElement;
            const isTyping = activeEl && (
                activeEl.tagName === 'INPUT' ||
                activeEl.tagName === 'TEXTAREA' ||
                activeEl.closest('.CodeMirror')
            );
            if (isTyping) return;

            e.preventDefault();
            toggleQuickMenu(CACHED_ELEMENTS, FIXED_RIGHT_BUTTONS);
        }
    });

    setupQuickMenuInteractions(isMobile, CACHED_ELEMENTS, FIXED_RIGHT_BUTTONS);
    setupScrollToTop(CACHED_ELEMENTS);
    setupMaximizeMode();
    setupCustomTagTemplates();
    setupAutoTagSettings();
}

function copyToClipboard() {
    const text = getResultEditorInstance()?.getValue() || '';
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        const msg = document.getElementById('copyMessage');
        msg.style.display = 'inline';
        setTimeout(() => msg.style.display = 'none', 1500);
    });
}

function setupScrollToTop(CACHED_ELEMENTS) {
    const updateVisibility = () => {
        if (document.body.scrollTop > 200 || document.documentElement.scrollTop > 200) {
            CACHED_ELEMENTS.scrollTopBtn.style.display = "flex";
        } else {
            CACHED_ELEMENTS.scrollTopBtn.style.display = "none";
        }
    };

    window.onscroll = updateVisibility;
    CACHED_ELEMENTS.scrollTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    updateVisibility();
}

/**
 * [추가] 애플리케이션의 모든 상태를 초기화하고 UI를 갱신합니다.
 */
function resetApplicationState() {
    setCodeBlocks({});
    localStorage.removeItem('htmlTemplateGeneratorState');
    setVariableConfigs({});
    setSyncGroups({});
    setSyncColorMap({});
    setTemplateOrder([]);
    setCurrentFilter('all');
    setCurrentSort('default');
    setTheme('light');
    const sample = '<div>\n  <h1>{{title}}</h1>\n  <p>{{content}}</p>\n  <span>Author: {{author}}</span>\n</div>';
    getEditorInstance()?.setValue(sample);
    
    // UI 갱신
    processTemplateAndExtractVariables();
    renderQuickMenu();
    generateResult();
    
    // 상태 저장 및 알림
    saveState();
    showToast('모든 설정이 초기화되었습니다.', 'info');
}

/**
 * [추가] 초기화 확인 모달의 이벤트 리스너를 설정합니다.
 */
function setupResetModal() {
    const resetModal = document.getElementById('resetConfirmModal');
    const confirmResetBtn = document.getElementById('confirmResetBtn');
    const cancelResetBtn = document.getElementById('cancelResetBtn');

    document.getElementById('clearStateBtn').addEventListener('click', () => {
        resetModal.classList.add('is-visible');
    });

    cancelResetBtn.addEventListener('click', () => resetModal.classList.remove('is-visible'));
    resetModal.addEventListener('click', (e) => { if (e.target === resetModal) resetModal.classList.remove('is-visible'); });
    confirmResetBtn.addEventListener('click', () => {
        resetApplicationState();
        resetModal.classList.remove('is-visible');
    });
}

/**
 * [추가] '변수 추출 및 업데이트' 버튼의 표시 여부를 결정합니다.
 */
export function updateExtractBtnVisibility() {
    const extractBtn = document.getElementById('extractBtn');
    const currentTemplate = getEditorInstance()?.getValue() || '';
    extractBtn.style.display = (currentTemplate !== window.lastSavedTemplate) ? 'block' : 'none';
}

let cbModalState = {
    currentStep: 1,
    selectedBlockId: null,
    templatePreviewEditor: null,
    blockEditor: null,
};

// [수정] 모달 UI 요소들을 모듈 스코프로 이동하여 여러 함수에서 접근 가능하도록 합니다.
const newBlockInputContainer = document.getElementById('cb-new-block-input-container');
const newBlockNameInput = document.getElementById('cb-new-block-name-input');
const confirmNewBlockBtn = document.getElementById('cb-confirm-new-block-btn');
const cancelNewBlockBtn = document.getElementById('cb-cancel-new-block-btn');
const newBlockBtnContainer = document.getElementById('cb-new-block-btn').parentElement;

function openCodeBlockModal() {
    cbModalState.currentStep = 1;
    cbModalState.selectedBlockId = null;
    updateCodeBlockModalView();
    document.getElementById('codeBlockModal').classList.add('is-visible');
}

function setupCodeBlockModal() {
    const modal = document.getElementById('codeBlockModal');
    const prevBtn = document.getElementById('cb-prev-step-btn');
    const nextBtn = document.getElementById('cb-next-step-btn');

    let isMouseDownOnOverlay = false;

    document.getElementById('codeBlockModalCloseBtn').addEventListener('click', () => {
        modal.classList.remove('is-visible');
    });

    // [추가] 배경 클릭으로 모달을 닫는 로직 (드래그 제외)
    modal.addEventListener('mousedown', (e) => {
        if (e.target === modal) {
            isMouseDownOnOverlay = true;
        }
    });

    modal.addEventListener('mouseup', (e) => {
        if (e.target === modal && isMouseDownOnOverlay) {
            modal.classList.remove('is-visible');
        }
        isMouseDownOnOverlay = false;
    });


    prevBtn.addEventListener('click', () => {
        if (cbModalState.currentStep > 1) {
            cbModalState.currentStep--;
            updateCodeBlockModalView();
        }
    });

    nextBtn.addEventListener('click', () => {
        if (cbModalState.currentStep === 2) {
            const block = codeBlocks[cbModalState.selectedBlockId];
            if (block && cbModalState.blockEditor) {
                block.template = cbModalState.blockEditor.getValue();
                saveState();
                processTemplateAndExtractVariables();
                showToast(`'${block.name}' 블록이 저장되었습니다.`, 'info');
                cbModalState.currentStep = 3;
                updateCodeBlockModalView();
            }
        }
    });

    document.getElementById('cb-new-block-btn').addEventListener('click', () => {
        // [수정] prompt 대신 입력 필드를 표시합니다.
        document.getElementById('cb-modal-list').style.display = 'none';
        newBlockBtnContainer.style.display = 'none';
        newBlockInputContainer.style.display = 'block';
        newBlockNameInput.focus();
    });

    cancelNewBlockBtn.addEventListener('click', () => {
        newBlockInputContainer.style.display = 'none';
        document.getElementById('cb-modal-list').style.display = 'block';
        newBlockBtnContainer.style.display = 'flex';
        newBlockNameInput.value = '';
    });

    confirmNewBlockBtn.addEventListener('click', () => {
        const name = newBlockNameInput.value.trim();
        if (!name) {
            showToast('블록 이름을 입력해주세요.', 'warning');
            return;
        }
        if (Object.values(codeBlocks).some(b => b.name === name)) {
            showToast('이미 사용 중인 이름입니다.', 'warning');
            return;
        }
        const id = `block_${Date.now()}`;
        codeBlocks[id] = { name: name, template: '' };
        cbModalState.selectedBlockId = id;
        cbModalState.currentStep = 2;
        updateCodeBlockModalView();
        saveState();
    });

     document.getElementById('cb-insert-here-btn').addEventListener('click', () => {
        if (!cbModalState.selectedBlockId) {
            showToast('삽입할 블록이 선택되지 않았습니다.', 'error');
            return;
        }
        const mainEditor = getEditorInstance();
        const previewCursor = cbModalState.templatePreviewEditor.getCursor();
        mainEditor.setCursor(previewCursor); // 메인 에디터 커서 위치 동기화
        const success = insertCodeBlock(cbModalState.selectedBlockId);
        if (success) {
            document.getElementById('codeBlockModal').classList.remove('is-visible');
            showToast('코드 블록이 삽입되었습니다.', 'info');
        }
    });
}

function updateCodeBlockModalView() {
    const slider = document.querySelector('#codeBlockModal .slider-wrapper');
    const prevBtn = document.getElementById('cb-prev-step-btn');
    const nextBtn = document.getElementById('cb-next-step-btn');
    const step = cbModalState.currentStep;

    slider.style.transform = `translateX(-${(step - 1) * (100 / 3)}%)`;

    // [수정] 복잡한 높이 계산 로직을 제거하고, CSS 클래스로 제어합니다.
    document.querySelectorAll('.slider-panel').forEach((panel, index) => {
        panel.classList.toggle('active', (index + 1) === step);
    });

    // [수정] 단계에 따라 화살표 버튼의 표시 여부를 제어합니다.
    prevBtn.style.visibility = (step > 1) ? 'visible' : 'hidden';
    nextBtn.style.visibility = (step === 2) ? 'visible' : 'hidden';

    // 각 패널 업데이트
    if (step === 1) renderCbPanel1();
    // 1단계로 돌아올 때, 이름 입력 UI를 숨기고 목록을 다시 표시합니다.
    if (step === 1) {
        newBlockInputContainer.style.display = 'none';
        document.getElementById('cb-modal-list').style.display = 'block';
        newBlockBtnContainer.style.display = 'flex';
    }
    if (step === 2) renderCbPanel2();
    if (step === 3) renderCbPanel3();
}

function renderCbPanel1() {
    const list = document.getElementById('cb-modal-list');
    list.innerHTML = '';
    if (Object.keys(codeBlocks).length === 0) {
        list.innerHTML = '<p class="hint">저장된 코드 블록이 없습니다. 새로 추가해보세요.</p>';
    }
    Object.entries(codeBlocks).forEach(([id, block]) => {
        const item = document.createElement('div');
        item.className = 'cb-list-item';
        item.textContent = block.name;
        item.dataset.id = id;
        item.addEventListener('click', () => {
            cbModalState.selectedBlockId = id;
            cbModalState.currentStep = 2;
            updateCodeBlockModalView();
        });
        list.appendChild(item);
    });
}

function renderCbPanel2() {
    const panel = document.getElementById('cb-panel-2');
    const block = codeBlocks[cbModalState.selectedBlockId];
    if (!block) return;

    panel.innerHTML = `
        <h5>2. 블록 편집: ${escapeHTML(block.name)}</h5>
        <div id="cb-editor-wrapper"></div>
        <div class="flex" style="margin-top: 12px; justify-content: flex-end;">
            <button id="cb-delete-btn" class="warning">이 블록 삭제</button>
        </div>
    `;

    const editorWrapper = panel.querySelector('#cb-editor-wrapper');
    cbModalState.blockEditor = window.CodeMirror(editorWrapper, {
        value: block.template,
        mode: 'xml', lineNumbers: true, lineWrapping: true,
        theme: currentTheme === 'dark' ? 'material-darker' : 'default',
    });

    // [추가] 에디터 내용이 변경될 때마다 코드 블록 주석을 숨깁니다.
    cbModalState.blockEditor.on('change', () => {
        markCodeBlocks(cbModalState.blockEditor);
    });

    // [수정] 에디터가 표시된 후 높이를 재계산하여 이전 단계의 높이가 유지되는 문제를 해결합니다.
    setTimeout(() => {
        cbModalState.blockEditor.refresh();
    }, 0);

    panel.querySelector('#cb-delete-btn').addEventListener('click', () => {
        if (confirm(`'${block.name}' 블록을 삭제하시겠습니까?`)) {
            deleteCodeBlockTemplate(cbModalState.selectedBlockId, false); // Don't close modal
            cbModalState.selectedBlockId = null;
            cbModalState.currentStep = 1;
            updateCodeBlockModalView();
        }
    });
}

function renderCbPanel3() {
    const panel = document.getElementById('cb-panel-3');
    // [수정] 패널 내용을 초기화하고 새로운 구조를 추가합니다.
    panel.innerHTML = `
        <h5>3. 템플릿에 삽입</h5>
        <p class="hint">블록을 삽입할 위치에 커서를 놓거나, 에디터를 직접 수정하세요. (Shift+Enter로 삽입)</p>
        <div id="cb-template-preview-wrapper"></div>
        <div class="flex" style="margin-top: 8px; justify-content: center;">
            <button id="cb-insert-here-btn" data-icon="add"><span>삽입</span></button>
        </div>
    `;

    const editorWrapper = panel.querySelector('#cb-template-preview-wrapper');
    cbModalState.templatePreviewEditor = window.CodeMirror(editorWrapper, {
        value: getEditorInstance().getValue(), // [수정] 편집 가능하도록 readOnly: false로 변경
        mode: 'xml', lineNumbers: true, lineWrapping: true, readOnly: false,
        theme: currentTheme === 'dark' ? 'material-darker' : 'default',
    });

    // [추가] 에디터 내용이 변경될 때마다 코드 블록 주석을 숨깁니다.
    cbModalState.templatePreviewEditor.on('change', () => {
        markCodeBlocks(cbModalState.templatePreviewEditor);
        // [추가] 미리보기 에디터의 내용을 메인 에디터에 실시간으로 동기화합니다.
        getEditorInstance().setValue(cbModalState.templatePreviewEditor.getValue());
    });

    // [추가] Shift+Enter 단축키로 블록을 삽입하는 이벤트 핸들러
    cbModalState.templatePreviewEditor.on('keydown', (cm, e) => {
        if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            panel.querySelector('#cb-insert-here-btn').click();
        }
    });

    // [추가] '여기에 삽입' 버튼 아이콘 로드
    const insertBtn = panel.querySelector('#cb-insert-here-btn');
    if (insertBtn) {
        loadIcon(insertBtn.dataset.icon, { target: insertBtn });
    }

    // [추가] '여기에 삽입' 버튼 이벤트 리스너를 다시 연결합니다.
    panel.querySelector('#cb-insert-here-btn').addEventListener('click', () => {
        if (!cbModalState.selectedBlockId) {
            showToast('삽입할 블록이 선택되지 않았습니다.', 'error');
            return;
        }
        // [수정] 삽입 전, 미리보기 에디터의 현재 내용을 메인 에디터에 반영합니다.
        const mainEditor = getEditorInstance();
        const previewEditor = cbModalState.templatePreviewEditor;
        if (mainEditor.getValue() !== previewEditor.getValue()) {
            mainEditor.setValue(previewEditor.getValue());
        }
        const previewCursor = cbModalState.templatePreviewEditor.getCursor();
        mainEditor.setCursor(previewCursor); // 메인 에디터 커서 위치 동기화
        const success = insertCodeBlock(cbModalState.selectedBlockId);
        if (success) {
            document.getElementById('codeBlockModal').classList.remove('is-visible');
            showToast('코드 블록이 삽입되었습니다.', 'info');
        }
    });
}


function insertCodeBlock(blockId) {
    const block = codeBlocks[blockId];
    if (!block) return;

    const instanceId = `${blockId}_instance_${Date.now()}`;
    let templateToInsert = block.template;
    const varRegex = /{{\s*([^\s{}]+)\s*}}/g;
    const newVarMappings = {};

    templateToInsert = templateToInsert.replace(varRegex, (match, varName) => {
        let newVarName = `${instanceId}_${varName}`;
        let counter = 1;
        // 충돌 해결 로직
        while (variableConfigs[newVarName]) {
            newVarName = `${instanceId}_${varName}_${counter}`;
            if (variableConfigs[newVarName]) { // 숫자 접미사로도 충돌 시
                newVarName = `${instanceId}_${varName}_${counter}_${Math.random().toString(36).substring(7, 8)}`;
            }
            if (counter > 100) { // 무한 루프 방지
                showToast(`변수 이름 충돌을 해결할 수 없습니다: ${varName}`, 'error');
                return `{{ERROR_VAR_CONFLICT_${varName}}}`;
            }
            counter++;
        }

        newVarMappings[varName] = newVarName;
        return `{{${newVarName}}}`;
    });

    // 원본 변수 설정을 복사하여 새 변수 생성
    Object.keys(newVarMappings).forEach(originalVar => {
        const newVar = newVarMappings[originalVar];
        const originalConfig = variableConfigs[originalVar];
        if (originalConfig) {
            variableConfigs[newVar] = JSON.parse(JSON.stringify(originalConfig)); // Deep copy
        } else {
            variableConfigs[newVar] = { mode: 'text', options: [], default: '', syncWith: [] };
        }
    });

    const startComment = `<!-- START: ${instanceId} -->`;
    const endComment = `<!-- END: ${instanceId} -->`;
    const fullBlock = `${startComment}\n${templateToInsert}\n${endComment}`;

    const editor = getEditorInstance();
    const doc = editor.getDoc();
    const cursor = doc.getCursor();

    // [추가] 커서 위치가 다른 코드 블록 내부에 있는지 확인합니다.
    const textBeforeCursor = doc.getRange({ line: 0, ch: 0 }, cursor);
    const textAfterCursor = doc.getRange(cursor, { line: doc.lastLine() });

    const startCommentRegex = /<!-- START: (block_.*?_instance_.*?) -->/g;
    const endCommentRegex = /<!-- END: (block_.*?_instance_.*?) -->/g;

    let openBlocks = new Set();
    let match;

    // 커서 이전의 텍스트에서 열린 블록을 찾습니다.
    while ((match = startCommentRegex.exec(textBeforeCursor)) !== null) {
        openBlocks.add(match[1]);
    }
    while ((match = endCommentRegex.exec(textBeforeCursor)) !== null) {
        openBlocks.delete(match[1]);
    }

    if (openBlocks.size > 0) {
        showToast('코드 블록 내부에 다른 코드 블록을 삽입할 수 없습니다.', 'error');
        return false; // [수정] 실패를 나타내는 false 반환
    }

    doc.replaceRange(fullBlock, cursor);
    editor.focus();

    // 이벤트 강제 발생 (CodeMirror의 'change' 이벤트가 자동으로 발생합니다)
    processTemplateAndExtractVariables(true); // [수정] 코드 블록 삽입임을 명시적으로 알립니다.
    saveState();
    return true; // [추가] 성공을 나타내는 true 반환
}

/**
 * [추가] 특정 코드 블록 '인스턴스'를 템플릿과 변수 설정에서 삭제합니다.
 * @param {string} instanceId - 삭제할 인스턴스의 ID (예: block_123_instance_456)
 */
function deleteCodeBlockInstance(instanceId) {
    // 1. 템플릿에서 해당 인스턴스 제거
    const editor = getEditorInstance();
    if (editor) {
        const currentValue = editor.getValue();
        const regex = new RegExp(`<!-- START: ${instanceId} -->[\\s\\S]*?<!-- END: ${instanceId} -->\\n?`, 'g');
        editor.setValue(currentValue.replace(regex, ''));
    }

    // 2. 관련된 변수들 정리
    Object.keys(variableConfigs).forEach(varName => {
        if (varName.startsWith(instanceId)) {
            delete variableConfigs[varName];
        }
    });

    saveState();
    processTemplateAndExtractVariables(); // UI 갱신
    showToast('코드 블록 인스턴스가 삭제되었습니다.', 'info');
}

/**
 * [수정] 코드 블록 '템플릿'을 삭제하고, 관련된 모든 인스턴스를 함께 제거합니다.
 * @param {string} blockId - 삭제할 블록 템플릿의 ID
 * @param {boolean} [triggerRender=true] - 삭제 후 UI를 다시 렌더링할지 여부
 */
function deleteCodeBlockTemplate(blockId, triggerRender = true) {
    // 1. 블록 템플릿 정의 삭제
    delete codeBlocks[blockId];

    // 2. 관련된 모든 인스턴스 삭제 (이벤트 핸들러에서 UI 갱신)
    const editorValue = getEditorInstance()?.getValue() || '';
    const instanceRegex = new RegExp(`<!-- START: (${blockId}_instance_\\d+) -->`, 'g');
    let match;
    while ((match = instanceRegex.exec(editorValue)) !== null) {
        deleteCodeBlockInstance(match[1]);
    }
    saveState();
    if (triggerRender) {
        processTemplateAndExtractVariables();
    }
}