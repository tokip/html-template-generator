import { saveState, currentTheme } from '../state.js';
import { triggerResultGeneration, processTemplateAndExtractVariables } from '../core.js';
import { updateExtractBtnVisibility } from '../events.js';
import { debounce } from '../utils.js';

let editorInstance = null;
let resultEditorInstance = null;

export function getEditorInstance() {
    return editorInstance;
}

export function getResultEditorInstance() {
    return resultEditorInstance;
}


export function markCodeBlocks(cm) {
    if (!cm) return;

    cm.operation(() => {
        // Clear previous marks
        // [수정] 모든 마커를 지우도록 단순화하여, 이전 상태가 남는 문제를 방지합니다.
        cm.getAllMarks().forEach(mark => mark.clear());

        const value = cm.getValue();
        const startRegex = /<!-- START: (block_.*?) -->/g;
        let match;

        while ((match = startRegex.exec(value)) !== null) {
            const instanceId = match[1];
            const endComment = `<!-- END: ${instanceId} -->`;
            const endIndex = value.indexOf(endComment, match.index);

            if (endIndex !== -1) {
                const startPos = cm.posFromIndex(match.index);
                const endPos = cm.posFromIndex(endIndex + endComment.length);

                // Mark background for the entire block
                cm.markText(startPos, endPos, {
                    className: 'cm-code-block-background',
                    inclusiveLeft: true,
                    inclusiveRight: true,
                });

                // [수정] 시작 주석을 편집 불가능하고 보이지 않는 원자 단위로 만듭니다.
                // [수정] 주석뿐만 아니라 해당 줄 전체를 숨기기 위해 다음 줄의 시작까지 포함합니다.
                const startCommentEndPos = { line: startPos.line + 1, ch: 0 };
                cm.markText(startPos, startCommentEndPos, { 
                    atomic: true,
                    readOnly: true,
                    replacedWith: document.createElement('span'),
                    inclusiveLeft: true,
                    inclusiveRight: false // 다음 줄의 시작 부분은 포함하지 않음
                });

                // [수정] 종료 주석을 편집 불가능하고 보이지 않는 원자 단위로 만듭니다.
                const endCommentStartPos = cm.posFromIndex(endIndex);
                // [수정] 종료 주석이 포함된 줄 전체를 숨깁니다.
                const endCommentEndPos = { line: endCommentStartPos.line + 1, ch: 0 };
                cm.markText(endCommentStartPos, endCommentEndPos, {
                    atomic: true,
                    readOnly: true,
                    replacedWith: document.createElement('span'),
                    inclusiveLeft: true,
                    inclusiveRight: false
                });
            }
        }
    });
}

export function initializeTemplateEditor() {
    const wrapper = document.getElementById('templateInputWrapper');
    if (!wrapper) return null;

    editorInstance = window.CodeMirror(wrapper, {
        mode: 'xml',
        lineNumbers: true,
        lineWrapping: true,
        autofocus: true,
        theme: currentTheme === 'dark' ? 'material-darker' : 'default',
        value: '<!-- 템플릿을 여기에 입력하세요 -->',
    });

    editorInstance.on('change', debounce(() => {
        markCodeBlocks(editorInstance);
        saveState();
        updateExtractBtnVisibility(); // [추가] 변경 시 버튼 표시 여부 업데이트
        triggerResultGeneration();
    }, 300));

    editorInstance.on('keydown', (cm, e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            processTemplateAndExtractVariables();
            document.getElementById('extractBtn').focus();
        }
    });

    markCodeBlocks(editorInstance); // Initial marking
    return editorInstance;
}

export function initializeResultEditor() {
    const wrapper = document.getElementById('resultOutputWrapper');
    if (!wrapper) return null;

    resultEditorInstance = window.CodeMirror(wrapper, {
        mode: 'xml',
        lineNumbers: true,
        lineWrapping: true,
        readOnly: true,
        theme: currentTheme === 'dark' ? 'material-darker' : 'default',
        value: '<!-- 결과가 여기에 표시됩니다 -->',
    });
    return resultEditorInstance;
}