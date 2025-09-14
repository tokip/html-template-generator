// 순환 참조를 제거하기 위해 core.js 및 ui 모듈 임포트 제거
import { showToast } from './utils.js';
import { getEditorInstance } from './ui/editor.js';
// import { processTemplateAndExtractVariables, generateResult } from './core.js';
// import { renderQuickMenu } from './ui/quick-menu.js';
// import { updateCollapseUI, updateLineNumbersFor } from './ui/dom-helpers.js';

// --- State Management ---
/**
 * @type {Object.<string, {mode: 'text'|'dropdown', options: {name:string, value:string}[], default: string, syncWith: string[]}>}
 * @description 각 변수의 설정을 저장하는 객체. key는 변수명입니다.
 */
export let variableConfigs = {};
export let codeBlocks = {};
export let regexTemplates = []; // [추가] 정규식 템플릿을 저장할 배열
export let keywordTemplates = []; // [추가] 키워드 템플릿을 저장할 배열
export let quickTaggingTemplates = []; // [추가] 퀵 커스텀 태깅 템플릿 저장
export let quickTaggingSelection = []; // [추가] 퀵 커스텀 태깅 선택 항목 저장
export let syncGroups = {};
export let tagTemplates = [];
export let autoTaggingConfig = {
    enabled: false,
    history: [],
    mode: 'keyword',
    keywords: '',
    regexPattern: '\\d+(?:\\.\\d+)?%',
    regexFlags: 'g',
    exclusion: '',
    replaceEnabled: false, // [추가] 키워드 대체 활성화 여부
    replaceKeyword: '' // [추가] 대체할 키워드
};
export let syncColorMap = {};
export let templateOrder = [];
export let currentFilter = 'all';
export let currentSort = 'default';
export let currentTheme = 'light'; // 테마는 setTheme 함수로 관리되므로 let으로 유지
export let savedUiState = null;

// --- State Setters ---
export function setVariableConfigs(newConfigs) { variableConfigs = newConfigs; }
export function setCodeBlocks(newBlocks) { codeBlocks = newBlocks; }
export function setSyncGroups(newGroups) { syncGroups = newGroups; }
export function setRegexTemplates(newTemplates) { regexTemplates = newTemplates; } // [추가]
export function setKeywordTemplates(newTemplates) { keywordTemplates = newTemplates; } // [추가]
export function setQuickTaggingTemplates(newTemplates) { quickTaggingTemplates = newTemplates; } // [추가]
export function setQuickTaggingSelection(newSelection) { quickTaggingSelection = newSelection; } // [추가]
export function setTagTemplates(newTemplates) { tagTemplates = newTemplates; }
export function setAutoTaggingConfig(newConfig) { autoTaggingConfig = newConfig; }
export function setSyncColorMap(newMap) { syncColorMap = newMap; }
export function setTemplateOrder(newOrder) { templateOrder = newOrder; }
export function setCurrentFilter(newFilter) { currentFilter = newFilter; }
export function setCurrentSort(newSort) { currentSort = newSort; } 
export function setCurrentTheme(newTheme) { currentTheme = newTheme; }
export function setSavedUiState(newState) { savedUiState = newState; }


// --- Data Persistence (localStorage & JSON) ---
export function saveState() {
    try {
        const state = {
            template: getEditorInstance()?.getValue() || '',
            codeBlocks: codeBlocks,
            configs: variableConfigs,
            keywordTemplates: keywordTemplates, // [추가]
            regexTemplates: regexTemplates, // [추가]
            quickTaggingTemplates: quickTaggingTemplates, // [추가]
            quickTaggingSelection: quickTaggingSelection, // [추가]
            tagTemplates: tagTemplates,
            autoTaggingConfig: autoTaggingConfig,
            regexHistory: autoTaggingConfig.history,
            syncGroups: syncGroups,
            theme: currentTheme,
            realtime: document.getElementById('realtimeToggle').checked
        };
        localStorage.setItem('htmlTemplateGeneratorState', JSON.stringify(state));
    } catch (e) {
        console.error("상태 저장 실패:", e);
        showToast('브라우저 저장 공간이 부족하여 상태를 저장할 수 없습니다.', 'error');
    }
}

export function loadState() {
    // 순환 참조를 피하기 위해, loadState는 상태를 로드하고 boolean 값만 반환합니다.
    // UI 업데이트와 초기화 로직은 main.js에서 담당하도록 책임을 이전합니다.
    // 이 함수를 호출하는 곳에서 반환값을 확인하고 필요한 후속 조치를 취해야 합니다.
    try {
        const savedState = localStorage.getItem('htmlTemplateGeneratorState');
        if (savedState) {
            const state = JSON.parse(savedState);
            // [수정] loadState는 더 이상 에디터 값을 직접 설정하지 않습니다.
            // main.js에서 상태 로드 성공 후 에디터 값을 설정합니다.
            if (getEditorInstance()) getEditorInstance().setValue(state.template || '');
            setCodeBlocks(state.codeBlocks || {});
            setKeywordTemplates(state.keywordTemplates || []); // [추가]
            setRegexTemplates(state.regexTemplates || []); // [추가]
            setQuickTaggingTemplates(state.quickTaggingTemplates || []); // [추가]
            setQuickTaggingSelection(state.quickTaggingSelection || []); // [추가]
            document.getElementById('realtimeToggle').checked = state.realtime !== false;

            if (state.configs) {
                Object.values(state.configs).forEach(cfg => {
                    if (cfg.mode === 'dropdown' && cfg.options && cfg.options.length > 0 && typeof cfg.options[0] === 'string') {
                        cfg.options = cfg.options.map(opt => ({ name: opt, value: opt }));
                    }
                });
                Object.keys(state.configs).forEach(key => {
                    if (!state.configs[key].syncWith) state.configs[key].syncWith = [];
                });
            }
            setSyncGroups(state.syncGroups || {});
            setVariableConfigs(state.configs || {});
            setTagTemplates(state.tagTemplates || []);

            if (state.regexHistory) autoTaggingConfig.history = state.regexHistory;
            setAutoTaggingConfig({ ...autoTaggingConfig, ...(state.autoTaggingConfig || {}) });

            // [수정] 테마 설정은 main.js에서 먼저 처리하므로 여기서 호출하지 않습니다.
            // setTheme(state.theme || 'light');
            return true;
        }
    } catch (e) {
        console.error("상태 불러오기 실패:", e);
        showToast('저장된 상태를 불러오는 데 실패했습니다. 손상되었을 수 있습니다.', 'error');
        localStorage.removeItem('htmlTemplateGeneratorState'); // 손상된 데이터 제거
        showToast('손상된 데이터가 삭제되었습니다. 페이지를 새로고침합니다.', 'info', 4000);
    }
    return false;
}

export function exportToJson() {
    const state = {
        template: getEditorInstance()?.getValue() || '',
        codeBlocks: codeBlocks,
        configs: variableConfigs,
        keywordTemplates: keywordTemplates, // [추가]
        regexTemplates: regexTemplates, // [추가]
        quickTaggingTemplates: quickTaggingTemplates, // [추가]
        quickTaggingSelection: quickTaggingSelection, // [추가]
        tagTemplates: tagTemplates,
        regexHistory: autoTaggingConfig.history,
        autoTaggingConfig: autoTaggingConfig,
        syncGroups: syncGroups,
        theme: currentTheme
    };
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateString = `${yyyy}-${mm}-${dd}`;

    // [성능 개선] 대용량 JSON 파일 처리를 위해 Blob 객체를 사용합니다.
    // Data URL 방식보다 메모리 효율적이며, 더 큰 파일 크기를 안정적으로 처리할 수 있습니다.
    const jsonString = JSON.stringify(state, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", url);
    downloadAnchorNode.setAttribute("download", `template_config_${dateString}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    URL.revokeObjectURL(url); // 메모리 누수 방지를 위해 URL 객체 해제
}

export function importFromJson(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const state = JSON.parse(e.target.result);
            if (state.template !== undefined && state.configs !== undefined) {
                getEditorInstance()?.setValue(state.template || '');
                setCodeBlocks(state.codeBlocks || {});
                setKeywordTemplates(state.keywordTemplates || []); // [추가]
                setRegexTemplates(state.regexTemplates || []); // [추가]
                setQuickTaggingTemplates(state.quickTaggingTemplates || []); // [추가]
                setQuickTaggingSelection(state.quickTaggingSelection || []); // [추가]
                setVariableConfigs(state.configs);
                setTagTemplates(state.tagTemplates || []);
                if (state.regexHistory) autoTaggingConfig.history = state.regexHistory;
                setAutoTaggingConfig({ ...autoTaggingConfig, ...(state.autoTaggingConfig || {}) });
                setSyncGroups(state.syncGroups || {});
                Object.keys(variableConfigs).forEach(key => {
                    if (!variableConfigs[key].syncWith) variableConfigs[key].syncWith = [];
                });
                setTheme(state.theme || 'light');

                // saveState는 stateImported 이벤트 핸들러에서 처리하므로 여기서 호출하지 않습니다. 
                getEditorInstance()?.setValue(state.template || '');
                document.getElementById('realtimeToggle').checked = state.realtime !== false;
                // JSON 가져오기 후 UI 갱신을 위해 커스텀 이벤트를 발생시킵니다.
                document.dispatchEvent(new CustomEvent('stateImported'));
            } else {
                showToast("잘못된 JSON 파일 형식입니다.", 'error');
            }
        } catch (err) {
            console.error(err);
            showToast("JSON 파일을 파싱하는 데 실패했습니다.", 'error');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

export function setTheme(theme) {
    setCurrentTheme(theme);
    const html = document.documentElement;

    if (theme === 'dark') {
        html.setAttribute('data-theme', 'dark');
    } else {
        html.removeAttribute('data-theme');
    }
    // UI 업데이트는 이 함수를 호출하는 쪽에서 담당합니다.
    // 'themeChanged' 이벤트를 발생시켜 UI 모듈이 반응하도록 합니다.
    document.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme } }));
}

export function saveUiState() {
    const activeElementId = document.activeElement ? document.activeElement.id : null;
    const state = {
        scrollY: window.scrollY,
        openDetails: new Set(),
        activeElementId: activeElementId
    };
    document.querySelectorAll('#variableFields details[open]').forEach(el => {
        state.openDetails.add(el.id);
    });
    setSavedUiState(state);
}

export function restoreUiState(preventScroll = false) {
    if (!savedUiState) return;
    const { scrollY, openDetails, activeElementId } = savedUiState;

    openDetails.forEach(id => document.getElementById(id)?.setAttribute('open', ''));

    const activeElement = activeElementId ? document.getElementById(activeElementId) : null;
    if (activeElement) activeElement.focus({ preventScroll: preventScroll });

    window.scrollTo(0, scrollY);
    setSavedUiState(null); // 복원 후 초기화
}