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


function markCodeBlocks() {
    if (!editorInstance) return;

    editorInstance.operation(() => {
        // Clear previous marks
        editorInstance.getAllMarks().forEach(mark => {
            if (mark.className === 'cm-code-block-background' || mark.className === 'cm-hidden-comment') {
                mark.clear();
            }
        });

        const value = editorInstance.getValue();
        const startRegex = /<!-- START: (block_.*?) -->/g;
        let match;

        while ((match = startRegex.exec(value)) !== null) {
            const instanceId = match[1];
            const endComment = `<!-- END: ${instanceId} -->`;
            const endIndex = value.indexOf(endComment, match.index);

            if (endIndex !== -1) {
                const startPos = editorInstance.posFromIndex(match.index);
                const endPos = editorInstance.posFromIndex(endIndex + endComment.length);

                // Mark background for the entire block
                editorInstance.markText(startPos, endPos, {
                    className: 'cm-code-block-background',
                    inclusiveLeft: true,
                    inclusiveRight: true,
                });

                // Hide the start and end comments
                const startCommentEndPos = editorInstance.posFromIndex(match.index + match[0].length);
                editorInstance.markText(startPos, startCommentEndPos, { className: 'cm-hidden-comment' });

                const endCommentStartPos = editorInstance.posFromIndex(endIndex);
                editorInstance.markText(endCommentStartPos, endPos, { className: 'cm-hidden-comment' });
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
        markCodeBlocks();
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

    markCodeBlocks(); // Initial marking
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