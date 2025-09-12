import { variableConfigs, setVariableConfigs, templateOrder, setTemplateOrder, saveState, codeBlocks, currentTheme } from './state.js';
import { applyFilterAndSort } from './ui/variable-fields.js';
import { doBeautify, escapeRegExp, showToast, escapeHTML } from './utils.js';
import { getEditorInstance, getResultEditorInstance } from './ui/editor.js';

export function processTemplateAndExtractVariables() {
    const oldVarCount = Object.keys(variableConfigs).length;

    let tpl = getEditorInstance()?.getValue() || '';
    const re = /{{\s*([^\s{}]+)\s*}}/g;
    const newVars = new Set();
    let m;

    // 1. 기본 템플릿에서 변수 추출
    while ((m = re.exec(tpl)) !== null) { newVars.add(m[1]); }

    // 2. 코드 블록 자체의 템플릿에서 변수 추출 (UI 렌더링 목적)
    Object.values(codeBlocks).forEach(block => {
        re.lastIndex = 0; // Reset regex
        while ((m = re.exec(block.template)) !== null) {
            newVars.add(m[1]);
        }
    });

    const newVariables = Array.from(newVars);
    setTemplateOrder(newVariables);
    const oldVariables = Object.keys(variableConfigs);

    const added = newVariables.filter(v => !oldVariables.includes(v));
    const removed = oldVariables.filter(v => !newVariables.includes(v));

    const RENAME_CONFIRM_EL = document.getElementById('renameConfirm');
    RENAME_CONFIRM_EL.style.display = 'none';
    RENAME_CONFIRM_EL.innerHTML = '';

    // 변수가 하나 추가되고 하나 삭제된 경우, 이름 변경으로 간주하고 사용자에게 확인을 요청합니다.
    if (added.length === 1 && removed.length === 1) {
        const from = removed[0], to = added[0];
        RENAME_CONFIRM_EL.innerHTML = `변수명이 <code>${escapeHTML(from)}</code>에서 <code>${escapeHTML(to)}</code>(으)로 변경되었나요?
        <button id="renameYes">네, 설정 유지</button> <button id="renameNo" class="secondary">아니요</button>`;
        RENAME_CONFIRM_EL.style.display = 'block';

        document.getElementById('renameYes').onclick = () => {
            variableConfigs[to] = variableConfigs[from];
            delete variableConfigs[from];
            RENAME_CONFIRM_EL.style.display = 'none';
            applyFilterAndSort(newVariables);
            saveState();
        };
        document.getElementById('renameNo').onclick = () => {
            delete variableConfigs[from];
            added.forEach(v => {
                if (!variableConfigs[v]) variableConfigs[v] = { mode: 'text', options: [], default: '', syncWith: [] };
            });
            RENAME_CONFIRM_EL.style.display = 'none';
            applyFilterAndSort(newVariables);
            saveState();
        };
    } else {
        const newConfigs = { ...variableConfigs }; // 상태 직접 변경을 피하기 위해 복사본 생성
        let changed = false;
        removed.forEach(v => {
            delete newConfigs[v];
            changed = true;
        });
        added.forEach(v => {
            if (!newConfigs[v]) newConfigs[v] = { mode: 'text', options: [], default: '', syncWith: [] };
        });
        setVariableConfigs(newConfigs);
        applyFilterAndSort(newVariables);
        if (changed || added.length > 0) {
            saveState();
        }
    }

    // UI 업데이트가 필요하다는 신호를 보냅니다.
    // detail 객체를 통해 어떤 종류의 업데이트인지 정보를 전달할 수 있습니다.
    const event = new CustomEvent('uiNeedsUpdate', { detail: { source: 'processTemplate', variableCount: newVariables.length, oldVarCount: oldVarCount } });
    document.dispatchEvent(event);
}

export function generateResult() {
    let out = getEditorInstance()?.getValue() || '';
    const allVars = new Set(Object.keys(variableConfigs));

    // 템플릿에 실제로 사용된 변수들을 다시 한번 파싱하여 누락 방지
    const re = /{{\s*([^\s{}]+)\s*}}/g;
    let match;
    while ((match = re.exec(out)) !== null) {
        allVars.add(match[1]);
    }

    const currentVars = Array.from(allVars);
    let stateChanged = false;

    currentVars.forEach(v => {
        const cfg = variableConfigs[v];
        let val = '';

        // 변수 설정이 존재하면 해당 값을 사용, 없으면 빈 문자열로 처리
        if (cfg) {
            val = cfg.default || '';
        } else {
            // 정의되지 않은 변수는 빈 문자열로 대체
        }
        
        // 값은 UI 요소에서 직접 가져오지 않고, state에 저장된 값을 사용합니다.
        // UI 이벤트 핸들러가 state를 업데이트하는 책임을 가집니다.
        
        const re = new RegExp('{{\\s*' + escapeRegExp(v) + '\\s*}}', 'g');
        out = out.replace(re, val);
    });

    const pretty = doBeautify(out);
    getResultEditorInstance()?.setValue(pretty);

    // [수정] 현재 테마에 맞는 스타일을 미리보기에 주입합니다.
    const previewThemeStyle = currentTheme === 'dark'
        ? 'background-color: #111827; color: #e5e7eb;'
        : 'background-color: #ffffff; color: #222222;';

    const styledOut = `<style>html,body{margin:0;padding:8px;box-sizing:border-box;width:100%;overflow:auto; ${previewThemeStyle}}</style>${out}`;
    document.getElementById('preview').srcdoc = styledOut;

    // UI 업데이트가 필요하다는 신호를 보냅니다.
    const event = new CustomEvent('uiNeedsUpdate', { detail: { source: 'generateResult' } });
    document.dispatchEvent(event);
}

export function triggerResultGeneration() {
    if (document.getElementById('realtimeToggle').checked) {
        generateResult();
    }
}