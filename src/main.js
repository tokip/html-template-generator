import { loadState, saveState, variableConfigs, setVariableConfigs, setTheme, currentTheme } from './state.js';
import { processTemplateAndExtractVariables, generateResult, triggerResultGeneration } from './core.js';
import { setupEventListeners, updateExtractBtnVisibility } from './events.js';
import { updateCollapseUI, setIcon } from './ui/dom-helpers.js';
import { renderQuickMenu } from './ui/quick-menu.js';
import { initializeTemplateEditor, initializeResultEditor, getEditorInstance, getResultEditorInstance } from './ui/editor.js';

document.addEventListener('DOMContentLoaded', async () => {
    // [추가] FOUC 방지를 위해 로딩 클래스 추가
    document.body.classList.add('is-loading');

    // [추가] CodeMirror 에디터 인스턴스를 저장할 변수
    let templateEditor;
    let resultEditor;
    window.lastSavedTemplate = ''; // [추가] 변수 추출 버튼 표시 여부를 위한 변수

    const CACHED_ELEMENTS = {
        // [수정] templateInput은 CodeMirror 인스턴스로 대체됩니다.
        // templateInput: document.getElementById('templateInput'),
        // resultOutput: document.getElementById('resultOutput'),
        realtimeToggle: document.getElementById('realtimeToggle'),
        variableFieldsContainer: document.getElementById('variableFields'),
        variablesContentWrapper: document.getElementById('variables-content-wrapper'),
        renameConfirm: document.getElementById('renameConfirm'),
        themeToggleBtn: document.getElementById('theme-toggle'),
        scrollTopBtn: document.getElementById('scrollTopBtn'),
        quickMenuToggleBtn: document.getElementById('quick-menu-toggle'),
        quickMenuPanel: document.getElementById('quick-menu-panel'),
        highlightedResult: document.getElementById('highlightedResult'),
        preview: document.getElementById('preview'),
        darkHljs: document.getElementById('dark-hljs'),
        // Elements for import/export and other buttons
        importFile: document.getElementById('importFile'),
        copyMessage: document.getElementById('copyMessage')
    };

    async function updateThemeUI(theme) {
        const { darkHljs, themeToggleBtn: toggleBtn } = CACHED_ELEMENTS;
        if (theme === 'dark') {
            if (darkHljs) darkHljs.media = 'all';
            if (toggleBtn) await setIcon(toggleBtn, 'sun');
        } else {
            if (darkHljs) darkHljs.media = 'none';
            if (toggleBtn) await setIcon(toggleBtn, 'moon');
        }
    }

    // [수정] 1. 테마 상태를 먼저 로드합니다.
    const savedTheme = JSON.parse(localStorage.getItem('htmlTemplateGeneratorState') || '{}').theme;
    if (savedTheme) {
        setTheme(savedTheme);
    }
    updateThemeUI(currentTheme);

    // [수정] 2. 확정된 테마로 에디터를 초기화합니다.
    templateEditor = initializeTemplateEditor();
    resultEditor = initializeResultEditor();

    // [수정] 3. 나머지 상태를 로드하고 UI를 렌더링합니다.
    if (loadState()) {
        // State loaded successfully, now render the UI based on the loaded state.
        // loadState 내부에서 에디터에 값을 설정합니다.
        window.lastSavedTemplate = templateEditor.getValue(); // [추가] 초기 상태 저장
        updateThemeUI(currentTheme); // 로드된 테마로 UI 업데이트
        processTemplateAndExtractVariables();
        generateResult();
    } else {
        // 저장된 상태가 없을 경우, 기본값으로 설정합니다.
        setTheme('light', CACHED_ELEMENTS);
        const sample = '<div>\n  <h1>{{title}}</h1>\n  <p>{{content}}</p>\n  <span>Author: {{author}}</span>\n</div>';
        templateEditor.setValue(sample);
        window.lastSavedTemplate = sample; // [추가] 초기 상태 저장

        const newVarConfigs = {
            'author': { 
                mode: 'dropdown', 
                options: [
                    { name: 'Alice', value: 'Alice' }, 
                    { name: 'Bob', value: 'Bob' }, 
                    { name: 'Charlie', value: 'Charlie' }
                ], 
                default: 'Alice', 
                syncWith: [] 
            }
        };
        setVariableConfigs(newVarConfigs);

        processTemplateAndExtractVariables();
        renderQuickMenu();
        saveState({
            template: templateEditor.getValue(),
            realtime: CACHED_ELEMENTS.realtimeToggle.checked
        });
        CACHED_ELEMENTS.variablesContentWrapper.classList.add('is-collapsed');
        updateCollapseUI(Object.keys(variableConfigs).length);
    }

    CACHED_ELEMENTS.variablesContentWrapper.classList.add('is-collapsed');
    updateCollapseUI(Object.keys(variableConfigs).length);
    renderQuickMenu();
    updateExtractBtnVisibility(); // [추가] 초기 버튼 상태 설정

    // [수정] JSON 가져오기 성공 후 UI를 완전히 새로고침하는 이벤트 리스너
    document.addEventListener('stateImported', () => {
        // 1. 템플릿에서 변수를 다시 추출하고 변수 필드를 렌더링합니다.
        const variablesContentWrapper = document.getElementById('variables-content-wrapper');
        if (variablesContentWrapper) variablesContentWrapper.classList.add('is-collapsed');
        processTemplateAndExtractVariables();
        window.lastSavedTemplate = templateEditor.getValue(); // [추가] 가져오기 후 상태 저장
        // 2. 업데이트된 변수로 결과를 다시 생성합니다.
        generateResult();
        // 3. 퀵 메뉴를 다시 렌더링합니다.
        document.dispatchEvent(new CustomEvent('codeBlocksUpdated')); // 코드 블록 UI 갱신
        renderQuickMenu();
        // 4. 기타 UI 요소들을 업데이트합니다. (테마 포함)
        updateCollapseUI(Object.keys(variableConfigs).length);
        updateThemeUI(currentTheme);
        saveState(); // 마지막으로 변경된 상태를 저장합니다.
    });

    // 중앙 이벤트 핸들러: UI 업데이트가 필요하다는 신호를 수신합니다.
    document.addEventListener('uiNeedsUpdate', (e) => {
        const { detail } = e;
        if (!detail || !detail.source) return;

        if (detail.source === 'processTemplate') {
            renderQuickMenu();
            updateCollapseUI(detail.variableCount);
            const wrapper = document.getElementById('variables-content-wrapper');
            if (detail.oldVarCount <= 4 && detail.variableCount > 4) {
                wrapper.classList.add('is-collapsed');
            }
        }
        if (detail.source === 'generateResult') {
            // updateLineNumbersFor('resultOutput'); // 이 기능은 CodeMirror로 대체될 수 있습니다.
        }
    });

    // 테마 변경을 감지하고 UI를 업데이트하는 중앙 리스너
    document.addEventListener('themeChanged', (e) => {
        updateThemeUI(e.detail.theme);
        const newTheme = e.detail.theme === 'dark' ? 'material-darker' : 'default';
        getEditorInstance()?.setOption('theme', newTheme);
        getResultEditorInstance()?.setOption('theme', newTheme);

    });

    // [추가] 모든 초기화가 끝난 후, 로딩 클래스를 제거하여 화면을 부드럽게 표시합니다.
    requestAnimationFrame(() => {
        document.body.classList.remove('is-loading');
    });

    await setupEventListeners(CACHED_ELEMENTS);
});