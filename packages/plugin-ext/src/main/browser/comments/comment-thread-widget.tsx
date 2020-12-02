/********************************************************************************
 * Copyright (C) 2020 Red Hat, Inc. and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/
import { MonacoEditorZoneWidget } from '@theia/monaco/lib/browser/monaco-editor-zone-widget';
import { Comment, CommentThread, CommentThreadCollapsibleState } from '../../../common/plugin-api-rpc-model';
import { CommentGlyphWidget } from './comment-glyph-widget';
import { BaseWidget, DISABLED_CLASS } from '@theia/core/lib/browser';
import * as ReactDOM from 'react-dom';
import * as React from 'react';
import { MouseTargetType } from '@theia/editor/lib/browser';
import { CommentsService } from './comments-service';
import {
    ActionMenuNode,
    CommandRegistry,
    CompositeMenuNode,
    MenuModelRegistry,
    MenuPath
} from '@theia/core/lib/common';
import { CommentsContextKeyService } from './comments-context-key-service';

export const COMMENT_INLINE_MENU: MenuPath = ['comment-inline-menu'];

export class CommentThreadWidget extends BaseWidget {

    protected _headingLabel: HTMLElement;
    protected zoneWidget: MonacoEditorZoneWidget;
    protected commentGlyphWidget: CommentGlyphWidget;

    private _isExpanded?: boolean;
    private inputValue: string = '';
    private readonly menu: CompositeMenuNode;

    public getGlyphPosition(): number {
        // if (this._commentGlyph) {
        // return this._commentGlyph.getPosition().position!.lineNumber;
        // }
        return 0;
    }

    // @postConstruct()
    // protected init(): void {
    //     this.render();
    // }

    /**
     * Don't modify DOM use React! only exposed for `focusInput`
     * Use `this.scmService.selectedRepository?.input.value` as a single source of truth!
     */
    protected readonly inputRef = React.createRef<HTMLTextAreaElement>();

    constructor(
        editor: monaco.editor.IStandaloneCodeEditor,
        private _owner: string,
        private _commentThread: CommentThread,
        private commentService: CommentsService,
        protected readonly menus: MenuModelRegistry,
        protected readonly contextKeyService: CommentsContextKeyService,
        protected readonly commands: CommandRegistry
    ) {
        super();
        this.toDispose.push(this.zoneWidget = new MonacoEditorZoneWidget(editor));
        this.toDispose.push(this.commentGlyphWidget = new CommentGlyphWidget(editor));
        this.toDispose.push(this._commentThread.onDidChangeCollasibleState(state => {
            if (state === CommentThreadCollapsibleState.Expanded && !this._isExpanded) {
                const lineNumber = this._commentThread.range.startLineNumber;

                this.display({ afterLineNumber: lineNumber, afterColumn: 1, heightInLines: 2});
                return;
            }

            if (state === CommentThreadCollapsibleState.Collapsed && this._isExpanded) {
                this.hide();
                return;
            }
        }));
        this.contextKeyService.commentIsEmpty.set(true);
        this.toDispose.push(this.zoneWidget.editor.onMouseDown(e => this.onEditorMouseDown(e)));
        this.toDispose.push(this.contextKeyService.onDidChange(() => this.update()));
        this.menu = this.menus.getMenu(COMMENT_INLINE_MENU);
        this.menu.children.map(node => node instanceof ActionMenuNode && node.action.when).forEach(exp => {
            if (typeof exp === 'string') {
                this.contextKeyService.setExpression(exp);
            }
        });
        // this._fillContainer(this.zone.containerNode);
        // this.createThreadLabel();
    }

    protected render(): void {
        const headHeight = Math.ceil(this.zoneWidget.editor.getOption(monaco.editor.EditorOption.lineHeight) * 1.2);
        const hasExistingComments = this._commentThread.comments && this._commentThread.comments.length > 0;
        const getInput: () => string = () => this.inputValue;
        const clearInput: () => void = () => {
            const input = this.inputRef.current;
            if (input) {
                this.inputValue = '';
                input.value = this.inputValue;
                this.contextKeyService.commentIsEmpty.set(true);
            }
        };
        const onInput: (event: React.FormEvent) => void = (event: React.FormEvent) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const value = (event.target as any).value;
            if (this.inputValue.length === 0 || value.length === 0) {
                this.contextKeyService.commentIsEmpty.set(value.length === 0);
            }
            this.inputValue = value;
        };
        ReactDOM.render(<div className={'review-widget'}>
            <div className={'head'} style={{ height: headHeight, lineHeight: `${headHeight}px`}}>
                <div className={'review-title'}>
                    <span className={'filename'}>{this.getThreadLabel()}</span>
                </div>
                <div className={'review-actions'}>
                    <div className={'monaco-action-bar animated'}>
                        <ul className={'actions-container'} role={'toolbar'}>
                            <li className={'action-item'} role={'presentation'}>
                                <a className={'action-label codicon expand-review-action codicon-chevron-up'}
                                   role={'button'}
                                   tabIndex={0}
                                   title={'Collapse'}
                                   onClick={() => this.collapse()}
                                />
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
            <div className={'body'}>
                <div className={'comments-container'} role={'presentation'} tabIndex={0}>
                    {this.commentThread.comments?.map((comment, index) => <ReviewComment key={index} comment={comment}/>)}
                </div>
                <div className={'comment-form'}>
                    <div className={'theia-comments-input-message-container'}>
                        <textarea className={'theia-comments-input-message theia-input'}
                                  placeholder={hasExistingComments ? 'Reply...' : 'Type a new comment'}
                                  onInput={onInput}
                                  ref={this.inputRef}>
                        </textarea>
                    </div>
                    <CommentActions menu={this.menu}
                                    contextKeyService={this.contextKeyService}
                                    commands={this.commands}
                                    commentThread={this._commentThread}
                                    getInput={getInput}
                                    clearInput={clearInput}
                    />
                </div>
            </div>
        </div>, this.zoneWidget.containerNode);
    }

    public collapse(): Promise<void> {
        this._commentThread.collapsibleState = CommentThreadCollapsibleState.Collapsed;
        if (this._commentThread.comments && this._commentThread.comments.length === 0) {
            this.deleteCommentThread();
            return Promise.resolve();
        }

        this.hide();
        return Promise.resolve();
    }

    private deleteCommentThread(): void {
        this.dispose();
        this.commentService.disposeCommentThread(this.owner, this._commentThread.threadId);
    }

    dispose(): void {
        super.dispose();
        if (this.commentGlyphWidget) {
            this.commentGlyphWidget.dispose();
        }
    }

    toggleExpand(lineNumber: number): void {
        if (this._isExpanded) {
            this._commentThread.collapsibleState = CommentThreadCollapsibleState.Collapsed;
            this.hide();
            if (!this._commentThread.comments || !this._commentThread.comments.length) {
                this.deleteCommentThread();
            }
        } else {
            this._commentThread.collapsibleState = CommentThreadCollapsibleState.Expanded;
            this.display({ afterLineNumber: lineNumber, afterColumn: 1, heightInLines: 2 });
        }
    }

    hide(): void {
        this.zoneWidget.hide();
        this._isExpanded = false;
        super.hide();
    }

    display(options: MonacoEditorZoneWidget.Options): void {
        this._isExpanded = true;
        if (this._commentThread.collapsibleState && this._commentThread.collapsibleState !== CommentThreadCollapsibleState.Expanded) {
            return;
        }
        this.commentGlyphWidget.setLineNumber(options.afterLineNumber);
        this.commentThread.collapsibleState = CommentThreadCollapsibleState.Expanded;
        this.zoneWidget.show(options);
        this.update();
    }

    private onEditorMouseDown(e: monaco.editor.IEditorMouseEvent): void {
        const range = e.target.range;

        if (!range) {
            return;
        }

        if (!e.event.leftButton) {
            return;
        }

        if (e.target.type !== MouseTargetType.GUTTER_LINE_DECORATIONS) {
            return;
        }

        const data = e.target.detail;
        const gutterOffsetX = data.offsetX - data.glyphMarginWidth - data.lineNumbersWidth - data.glyphMarginLeft;

        // don't collide with folding and git decorations
        if (gutterOffsetX > 14) {
            return;
        }

        const mouseDownInfo = { lineNumber: range.startLineNumber };

        const { lineNumber } = mouseDownInfo;

        if (!range || range.startLineNumber !== lineNumber) {
            return;
        }

        if (e.target.type !== MouseTargetType.GUTTER_LINE_DECORATIONS) {
            return;
        }

        if (!e.target.element) {
            return;
        }

        if (this.commentGlyphWidget && this.commentGlyphWidget.getPosition() !== lineNumber) {
            return;
        }

        if (e.target.element.className.indexOf('comment-thread') >= 0) {
            this.toggleExpand(lineNumber);
            return;
        }

        if (this.commentThread.collapsibleState === CommentThreadCollapsibleState.Collapsed) {
            this.display({ afterLineNumber: mouseDownInfo.lineNumber, heightInLines: 2 });
        } else {
            this.hide();
        }
    }

    public get owner(): string {
        return this._owner;
    }

    public get commentThread(): CommentThread {
        return this._commentThread;
    }

    private getThreadLabel(): string {
        let label: string | undefined;
        label = this._commentThread.label;

        if (label === undefined) {
            if (this._commentThread.comments && this._commentThread.comments.length) {
                const onlyUnique = (value: Comment, index: number, self: Comment[]) => self.indexOf(value) === index;
                const participantsList = this._commentThread.comments.filter(onlyUnique).map(comment => `@${comment.userName}`).join(', ');
                label = `Participants: ${participantsList}`;
            } else {
                label = 'Start discussion';
            }
        }

        // if (label) {
        //     this._headingLabel.innerHTML = label;
        //     this._headingLabel.setAttribute('aria-label', label);
        // }

        return label;
    }

    update(): void {
        this.render();
        const headHeight = Math.ceil(this.zoneWidget.editor.getOption(monaco.editor.EditorOption.lineHeight) * 1.2);
        const lineHeight = this.zoneWidget.editor.getOption(monaco.editor.EditorOption.lineHeight);
        const arrowHeight = Math.round(lineHeight / 3);
        const frameThickness = Math.round(lineHeight / 9) * 2;
        const body = this.zoneWidget.containerNode.getElementsByClassName('body')[0];

        const computedLinesNumber = Math.ceil((headHeight + body.clientHeight + arrowHeight + frameThickness + 8 /** margin bottom to avoid margin collapse */) / lineHeight);
        this.zoneWidget.show({ afterLineNumber: this.commentThread.range.startLineNumber, heightInLines: computedLinesNumber });
        (this.inputRef.current || this.node).focus();
    }
}

namespace ReviewComment {
    export interface Props  {
        comment: Comment;
    }
}

export class ReviewComment extends React.Component<ReviewComment.Props> {
    render(): React.ReactNode {
        const comment: Comment = this.props.comment;
        return <div className={'review-comment'} tabIndex={-1} aria-label={`${comment.userName}, ${comment.body.value}`}>
            <div className={'avatar-container'}>
                <img className={'avatar'} src={comment.userIconPath}/>
            </div>
            <div className={'review-comment-contents'}>
                <div className={'comment-title monaco-mouse-cursor-text'}>
                    <strong className={'author'}>{comment.userName}</strong>
                    <span className={'isPending'}>{comment.label}</span>
                </div>
                <div className={'comment-body monaco-mouse-cursor-text'}>
                    <div>
                        <p>{comment.body.value}</p>
                    </div>
                </div>
            </div>
        </div>;
    }
}

namespace CommentActions {
    export interface Props  {
        contextKeyService: CommentsContextKeyService;
        commands: CommandRegistry;
        menu: CompositeMenuNode;
        commentThread: CommentThread;
        getInput: () => string;
        clearInput: () => void;
    }
}

export class CommentActions extends React.Component<CommentActions.Props> {
    render(): React.ReactNode {
        const {contextKeyService, commands, menu, commentThread, getInput, clearInput } = this.props;
        return <div className={'form-actions'}>
            {menu.children.map((node, index) => node instanceof ActionMenuNode &&
                <CommentAction key={index}
                               commands={commands}
                               node={node}
                               contextKeyService={contextKeyService}
                               commentThread={commentThread}
                               getInput={getInput}
                               clearInput={clearInput}
                />)}
        </div>;
    }
}
namespace CommentAction {
    export interface Props  {
        contextKeyService: CommentsContextKeyService;
        commands: CommandRegistry;
        node: ActionMenuNode;
        commentThread: CommentThread;
        getInput: () => string;
        clearInput: () => void;
    }
}

export class CommentAction extends React.Component<CommentAction.Props> {
    render(): React.ReactNode {
        const classNames = ['comments-button', 'comments-text-button', 'theia-button'];
        const { node, commands, contextKeyService, commentThread, getInput, clearInput } = this.props;
        if (node.action.when && !contextKeyService.match(node.action.when)) {
            return false;
        }
        const isEnabled = commands.isEnabled(node.action.commandId);
        if (!isEnabled) {
            classNames.push(DISABLED_CLASS);
        }
        return <a
            className={classNames.join(' ')}
            tabIndex={0}
            role={'button'}
            onClick={() => {
                if (isEnabled) {
                    commands.executeCommand(node.id, {
                        thread: commentThread,
                        text: getInput()
                    });
                    clearInput();
                }
            }}>{node.label}
        </a>;
    }
}
