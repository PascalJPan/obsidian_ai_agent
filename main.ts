/**
 * ENTRY POINT — ObsidianAgent Plugin
 *
 * This file wires together:
 * - Obsidian lifecycle (onload, commands, views)
 * - UI registration
 * - Calls into AI, validation, and edit modules
 *
 * IMPORTANT:
 * - Business logic lives outside this file
 * - Do not add new logic here unless it is Obsidian-specific
 *
 * See ARCHITECTURE.md for the full module map.
 */


import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, requestUrl, ItemView, WorkspaceLeaf, MarkdownPostProcessorContext, MarkdownRenderer, setIcon, MarkdownView } from 'obsidian';

// Import extracted modules
import {
	EditableScope,
	AICapabilities,
	EditInstruction,
	ValidatedEdit,
	InlineEdit,
	ChatMessage,
	TokenUsage,
	LinkDepth,
	ContextScopeConfig,
	EmbeddingIndex,
	EmbeddingModel,
	ContextInfo,
	NoteFrontmatter,
	TokenLimitedContextResult,
	// Web types (still used for settings)
	SearchApiType,
	WebSource,
	// Agent types
	AgentConfig,
	AgentCallbacks,
	AgentInput,
	AgentResult,
	AgentProgressEvent,
	KeywordResult,
	SemanticSearchResult,
	NotePreview,
	LinkInfo,
	WhitelistedCommand,
	CustomInfoTool,
	generateInfoToolName
} from './src/types';
import { runAgent } from './src/ai/agent';
import {
	generateEmbedding,
	searchSemantic,
	reindexVault,
	loadEmbeddingIndex,
	saveEmbeddingIndex
} from './src/ai/semantic';
import {
	buildTaskAgentSystemPrompt,
	CONTEXT_TASK_HEADER,
	CONTEXT_TASK_FOOTER,
	CONTEXT_DATA_HEADER,
	CONTEXT_DATA_FOOTER
} from './src/ai/prompts';
import { addLineNumbers, stripPendingEditBlocks } from './src/ai/context';
import { computeNewContent } from './src/ai/validation';
import { formatTokenUsage, MODEL_PRICING } from './src/ai/pricing';
import { webSearch, fetchPage } from './src/ai/searchApi';
import { isFileExcluded, isFolderExcluded } from './src/utils/fileUtils';
import { createLogger, summarizeSet, Logger } from './src/utils/logger';
import {
	TokenWarningModal,
	PendingEditsModal,
	ContextPreviewModal,
	NotePickerModal
} from './src/modals';
import { EditManager } from './src/edits/editManager';
import { DEFAULT_DATAVIEW_TOOL } from './src/defaults/dataviewReference';
import { DEFAULT_CUSTOM_INSTRUCTIONS } from './src/defaults/defaultInstructions';

// View type constant
const AI_ASSISTANT_VIEW_TYPE = 'ai-assistant-view';

// Settings interface
interface MyPluginSettings {
	openaiApiKey: string;
	aiModel: string;                // 'gpt-5-mini' | 'gpt-5-nano' | 'gpt-5' | 'gpt-4o' etc.
	customInstructions: string;     // Custom instructions (personality, tone, edit preferences)
	pendingEditTag: string;
	excludedFolders: string[];
	excludedTag: string;            // Tag that marks notes as private (e.g. "private")
	chatHistoryLength: number;      // Number of previous messages to include (0-100)
	debugMode: boolean;             // Log prompts and responses to console
	clearChatOnNoteSwitch: boolean; // Clear chat history when switching notes
	showTokenUsage: boolean;        // Show token count and cost estimate in chat
	customModelPricing: Record<string, { input: number; output: number }>; // User overrides for $/1M token rates
	// Semantic search settings
	embeddingModel: 'text-embedding-3-small' | 'text-embedding-3-large';
	// Agent settings
	agentMaxIterations: number;     // 5-20, max ReAct loop rounds
	agentMaxTokens: number;         // Total token budget across all rounds
	// Web search settings
	webAgentSearchApi: SearchApiType;      // 'openai' | 'serper' | 'brave' | 'tavily'
	webAgentSearchApiKey: string;          // API key for search service
	webAgentSnippetLimit: number;          // Max search results (default: 8)
	webAgentFetchLimit: number;            // Max pages to fetch in full (default: 3)
	webAgentTokenBudget: number;           // Max tokens for web content (default: 8000)
	// Default context scope settings (used to initialize view sliders for manual context)
	defaultLinkDepth: number;              // 0-3, default 2
	defaultMaxLinkedNotes: number;         // 0-50, default 20
	defaultMaxFolderNotes: number;         // 0-20, default 0
	defaultSemanticMatchCount: number;     // 0-20, default 0
	defaultSemanticMinSimilarity: number;  // 0-100, default 50
	// Default edit rules
	defaultEditableScope: EditableScope;   // 'current' | 'vault'
	defaultCanAdd: boolean;
	defaultCanDelete: boolean;
	disabledTools: string[];               // Agent tool names disabled by user (includes advanced tools)
	whitelistedCommands: WhitelistedCommand[]; // Commands the agent is allowed to execute
	customInfoTools: CustomInfoTool[];     // User-defined knowledge tools
	// Feature toggles
	enableWebSearch: boolean;              // Master toggle for web search features
	enableEmbeddings: boolean;             // Master toggle for embedding/semantic search
	enableManualContext: boolean;           // Master toggle for manual context panel
	// Internal migration tracking
	_defaultInfoToolsVersion?: number;     // Tracks which default info tools have been injected
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	openaiApiKey: '',
	aiModel: 'gpt-5-mini',
	customInstructions: DEFAULT_CUSTOM_INSTRUCTIONS,
	pendingEditTag: '#ai_edit',
	excludedFolders: [],
	excludedTag: 'private',
	chatHistoryLength: 10,
	debugMode: false,
	clearChatOnNoteSwitch: false,
	showTokenUsage: false,
	customModelPricing: {},
	embeddingModel: 'text-embedding-3-small',
	// Agent settings
	agentMaxIterations: 10,
	agentMaxTokens: 100000,
	// Web search settings
	webAgentSearchApi: 'openai',
	webAgentSearchApiKey: '',
	webAgentSnippetLimit: 8,
	webAgentFetchLimit: 3,
	webAgentTokenBudget: 8000,
	// Default context scope settings
	defaultLinkDepth: 2,
	defaultMaxLinkedNotes: 20,
	defaultMaxFolderNotes: 0,
	defaultSemanticMatchCount: 0,
	defaultSemanticMinSimilarity: 50,
	// Default edit rules - all capabilities enabled, context scope
	defaultEditableScope: 'vault',
	defaultCanAdd: true,
	defaultCanDelete: true,
	disabledTools: ['delete_note', 'execute_command'],
	whitelistedCommands: [],
	customInfoTools: [DEFAULT_DATAVIEW_TOOL],
	// Feature toggles - all off by default
	enableWebSearch: false,
	enableEmbeddings: false,
	enableManualContext: false
}

// Type definitions now imported from src/types.ts

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	embeddingIndex: EmbeddingIndex | null = null;
	logger: Logger;
	editManager: EditManager;

	// Cache of semantic file paths from most recent context build
	lastSemanticFilePaths: Set<string> = new Set();

	// Backlink cache for O(1) lookups instead of O(n) iteration
	private backlinkIndex: Map<string, string[]> | null = null;
	private backlinkIndexTimestamp: number = 0;
	private readonly BACKLINK_CACHE_TTL_MS = 5000; // 5 second cache

	constructor(app: App, manifest: any) {
		super(app, manifest);
		this.logger = createLogger(() => this.settings?.debugMode ?? false);
		// EditManager will be initialized in onload() after settings are loaded
		this.editManager = null!; // Placeholder, initialized in onload
	}

	debugLog(label: string, data: unknown) {
		if (this.settings.debugMode) {
			const formatted = typeof data === 'string'
				? data
				: JSON.stringify(data, null, 2);
			console.log(`[ObsidianAgent Debug] ${label}:\n${formatted}`);
		}
	}

	async onload() {
		await this.loadSettings();

		// Initialize EditManager with dependencies
		this.editManager = new EditManager({
			vault: this.app.vault,
			getPendingEditTag: () => this.settings.pendingEditTag,
			logger: this.logger,
			getActiveFile: () => this.app.workspace.getActiveFile(),
			getMarkdownFiles: () => this.app.vault.getMarkdownFiles()
		});

		// Load embedding index
		this.embeddingIndex = await loadEmbeddingIndex(
			this.app.vault,
			this.manifest.dir!,
			this.logger
		);

		// Validate embedding index model matches settings
		if (this.embeddingIndex && this.embeddingIndex.model !== this.settings.embeddingModel) {
			this.logger.warn('SEMANTIC', 'Embedding index model mismatch', {
				indexModel: this.embeddingIndex.model,
				settingsModel: this.settings.embeddingModel,
				action: 'Index will need reindexing to use new model'
			});
		}

		// Register the sidebar view
		this.registerView(
			AI_ASSISTANT_VIEW_TYPE,
			(leaf) => new AIAssistantView(leaf, this)
		);

		// Register markdown code block processor for ai-edit blocks
		this.registerMarkdownCodeBlockProcessor('ai-edit', (source, el, ctx) => {
			this.renderEditWidget(source, el, ctx);
		});

		// Register markdown code block processor for ai-new-note blocks
		this.registerMarkdownCodeBlockProcessor('ai-new-note', (source, el, ctx) => {
			this.renderNewNoteWidget(source, el, ctx);
		});

		// Command to open ObsidianAgent panel
		this.addCommand({
			id: 'open-obsidian-agent',
			name: 'Open ObsidianAgent',
			callback: () => this.activateView()
		});

		// Ribbon icon to toggle panel
		this.addRibbonIcon('brain', 'ObsidianAgent', () => this.activateView());

		// Batch commands for pending edits
		this.addCommand({
			id: 'accept-all-pending-edits',
			name: 'Accept all pending edits',
			callback: () => this.batchProcessEdits('accept')
		});

		this.addCommand({
			id: 'reject-all-pending-edits',
			name: 'Reject all pending edits',
			callback: () => this.batchProcessEdits('reject')
		});

		this.addCommand({
			id: 'show-pending-edits',
			name: 'Show pending edits',
			callback: () => this.showPendingEdits()
		});

		this.addCommand({
			id: 'search-pending-edits',
			name: 'Search pending edits',
			callback: () => this.openSearchWithQuery(this.settings.pendingEditTag)
		});

		// Single edit commands (for keyboard shortcuts)
		this.addCommand({
			id: 'accept-next-pending-edit',
			name: 'Accept next pending edit in current note',
			callback: () => this.processNextEdit('accept')
		});

		this.addCommand({
			id: 'reject-next-pending-edit',
			name: 'Reject next pending edit in current note',
			callback: () => this.processNextEdit('reject')
		});

		// Settings tab
		this.addSettingTab(new AIAssistantSettingTab(this.app, this));
	}

	onunload() {
		// Clean up view when plugin is disabled
		this.app.workspace.detachLeavesOfType(AI_ASSISTANT_VIEW_TYPE);
	}

	async loadSettings() {
		const loaded = await this.loadData();

		// Migrate old settings if present
		if (loaded) {
			// Migrate old systemPrompt
			if (loaded.systemPrompt && !loaded.customPromptQA) {
				const oldDefault = 'You are an AI Agent in an Obsidian vault with the following task:';
				if (loaded.systemPrompt !== oldDefault) {
					loaded.customPromptQA = loaded.systemPrompt;
				}
			}
			// Migrate old taskAgentTokenLimit to agentMaxTokens
			if (loaded.taskAgentTokenLimit !== undefined && loaded.agentMaxTokens === undefined) {
				loaded.agentMaxTokens = loaded.taskAgentTokenLimit * 10; // Scale up for agent loop
			}
			// Migrate old agenticMaxIterations to agentMaxIterations
			if (loaded.agenticMaxIterations !== undefined && loaded.agentMaxIterations === undefined) {
				loaded.agentMaxIterations = Math.min(loaded.agenticMaxIterations * 2, 20);
			}
			// Remove old settings
			delete loaded.systemPrompt;
			delete loaded.jsonEditSystemPrompt;
			delete loaded.tokenWarningThreshold;
			delete loaded.taskAgentTokenLimit;
			delete loaded.agenticScoutModel;
			delete loaded.agenticMaxIterations;
			delete loaded.agenticMaxNotes;
			delete loaded.agenticKeywordLimit;
			delete loaded.agenticMaxTokensPerIteration;
			delete loaded.scoutToolListNotes;
			delete loaded.scoutToolSearchKeyword;
			delete loaded.scoutToolSearchSemantic;
			delete loaded.scoutToolSearchTaskRelevant;
			delete loaded.scoutToolGetLinks;
			delete loaded.scoutToolGetLinksRecursive;
			delete loaded.scoutToolViewAllNotes;
			delete loaded.scoutToolExploreVault;
			delete loaded.scoutToolListAllTags;
			delete loaded.scoutToolAskUser;
			delete loaded.scoutSemanticLimit;
			delete loaded.scoutListNotesLimit;
			delete loaded.scoutShowTokenBudget;
			delete loaded.webAgentAutoSearch;
			delete loaded.webAgentMinFetchPages;
			delete loaded.webAgentMaxQueryRetries;
			delete loaded.agentToggles;
			// Migrate old customPromptCharacter + customPromptEdit → customInstructions
			if ((loaded.customPromptCharacter || loaded.customPromptEdit) && loaded.customInstructions === undefined) {
				const parts = [loaded.customPromptCharacter, loaded.customPromptEdit].filter((s: string) => s?.trim());
				loaded.customInstructions = parts.join('\n\n');
			}
			delete loaded.customPromptCharacter;
			delete loaded.customPromptEdit;

			// Migrate old toolToggles → disabledTools
			if (loaded.toolToggles) {
				const disabled = new Set<string>(loaded.disabledTools || []);
				const tt = loaded.toolToggles;
				if (tt.getProperties === false) disabled.add('get_properties');
				if (tt.getFileInfo === false) disabled.add('get_file_info');
				if (tt.findDeadLinks === false) disabled.add('find_dead_links');
				if (tt.queryNotes === false) disabled.add('query_notes');
				if (tt.manualContext === false) disabled.add('get_manual_context');
				// Old default-OFF tools: only add to disabled if NOT explicitly true
				if (tt.deleteNote !== true) disabled.add('delete_note');
				if (tt.executeCommand !== true) disabled.add('execute_command');
				loaded.disabledTools = [...disabled];
				delete loaded.toolToggles;
			}

			// Migrate old defaultCanCreate/defaultCanNavigate → disabledTools
			if (loaded.defaultCanCreate !== undefined || loaded.defaultCanNavigate !== undefined) {
				const disabled = new Set<string>(loaded.disabledTools || []);
				if (loaded.defaultCanCreate === false) disabled.add('create_note');
				if (loaded.defaultCanNavigate === false) disabled.add('open_note');
				loaded.disabledTools = [...disabled];
				delete loaded.defaultCanCreate;
				delete loaded.defaultCanNavigate;
			}

			// Inject default info tools for existing users (version-gated)
			const CURRENT_DEFAULT_INFO_VERSION = 1;
			const v = loaded._defaultInfoToolsVersion || 0;
			if (v < CURRENT_DEFAULT_INFO_VERSION) {
				if (!loaded.customInfoTools) loaded.customInfoTools = [];
				const existingIds = new Set(loaded.customInfoTools.map((t: any) => t.id));
				if (!existingIds.has(DEFAULT_DATAVIEW_TOOL.id)) {
					loaded.customInfoTools.push(DEFAULT_DATAVIEW_TOOL);
				}
				loaded._defaultInfoToolsVersion = CURRENT_DEFAULT_INFO_VERSION;
			}
		}

		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);

		// Migrate old editable scope values to new options
		if (this.settings.defaultEditableScope !== 'current' && this.settings.defaultEditableScope !== 'vault') {
			this.settings.defaultEditableScope = 'vault';
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// Notify all open ObsidianAgent views that settings have changed
	notifySettingsChanged(changedGroup: 'context' | 'editRules' | 'web') {
		const leaves = this.app.workspace.getLeavesOfType(AI_ASSISTANT_VIEW_TYPE);
		for (const leaf of leaves) {
			const view = leaf.view as AIAssistantView;
			view.onSettingsChanged(changedGroup);
		}
	}

	// Notify views about edit accept/reject for chat history feedback
	notifyEditFeedback(filePath: string, action: 'accept' | 'reject') {
		const leaves = this.app.workspace.getLeavesOfType(AI_ASSISTANT_VIEW_TYPE);
		for (const leaf of leaves) {
			const view = leaf.view as AIAssistantView;
			view.updateEditFeedbackInChat(filePath, action);
		}
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(AI_ASSISTANT_VIEW_TYPE)[0];

		if (!leaf) {
			// Create the leaf in the right sidebar
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				await rightLeaf.setViewState({
					type: AI_ASSISTANT_VIEW_TYPE,
					active: true
				});
				leaf = rightLeaf;
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	// Render inline edit widget (UI remains in main.ts, resolution delegated to EditManager)
	renderEditWidget(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		try {
			const edit: InlineEdit = JSON.parse(source);
			const widget = el.createDiv({ cls: 'ai-edit-widget' });

			// Type badge
			const typeBadge = widget.createDiv({ cls: 'ai-edit-type-badge' });
			if (edit.type === 'add') {
				typeBadge.setText('[+] Add');
				typeBadge.addClass('ai-edit-badge-add');
			} else if (edit.type === 'delete') {
				typeBadge.setText('[-] Delete');
				typeBadge.addClass('ai-edit-badge-delete');
			} else {
				typeBadge.setText('[~] Replace');
				typeBadge.addClass('ai-edit-badge-replace');
			}

			// Before content (for replace and delete) - render as markdown
			if (edit.before && (edit.type === 'replace' || edit.type === 'delete')) {
				const beforeDiv = widget.createDiv({ cls: 'ai-edit-before' });
				const beforeContent = edit.before.trimStart().startsWith('---') ? '\u200B' + edit.before : edit.before;
				MarkdownRenderer.render(this.app, beforeContent, beforeDiv, ctx.sourcePath, this);
			}

			// After content (for replace and add) - render as markdown
			if (edit.after && (edit.type === 'replace' || edit.type === 'add')) {
				const afterDiv = widget.createDiv({ cls: 'ai-edit-after' });
				const afterContent = edit.after.trimStart().startsWith('---') ? '\u200B' + edit.after : edit.after;
				MarkdownRenderer.render(this.app, afterContent, afterDiv, ctx.sourcePath, this);
			}

			// Action buttons
			const actions = widget.createDiv({ cls: 'ai-edit-actions' });

			const rejectBtn = actions.createEl('button', { cls: 'ai-edit-reject' });
			rejectBtn.setText('Reject');
			rejectBtn.addEventListener('click', async () => {
				await this.editManager.resolveEdit(ctx.sourcePath, edit, 'reject');
				this.notifyEditFeedback(ctx.sourcePath, 'reject');
			});

			const acceptBtn = actions.createEl('button', { cls: 'ai-edit-accept' });
			acceptBtn.setText('Accept');
			acceptBtn.addEventListener('click', async () => {
				await this.editManager.resolveEdit(ctx.sourcePath, edit, 'accept');
				this.notifyEditFeedback(ctx.sourcePath, 'accept');
			});

		} catch (e) {
			this.logger.error('PARSE', 'Failed to parse ai-edit block', e);
			el.createDiv({ cls: 'ai-edit-error', text: 'Invalid edit block' });
		}
	}

	// Render widget for AI-created notes (UI remains in main.ts, resolution delegated to EditManager)
	renderNewNoteWidget(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		try {
			const data = JSON.parse(source);
			const widget = el.createDiv({ cls: 'ai-new-note-widget' });

			const message = widget.createSpan({ cls: 'ai-new-note-message' });
			message.setText('This note was created by AI.');

			const actions = widget.createDiv({ cls: 'ai-new-note-actions' });

			const rejectBtn = actions.createEl('button', { cls: 'ai-new-note-reject' });
			rejectBtn.setText('\u2717');
			rejectBtn.title = 'Delete this note';
			rejectBtn.addEventListener('click', async () => {
				await this.editManager.resolveNewNote(ctx.sourcePath, data.id, 'reject');
				this.notifyEditFeedback(ctx.sourcePath, 'reject');
			});

			const acceptBtn = actions.createEl('button', { cls: 'ai-new-note-accept' });
			acceptBtn.setText('\u2713');
			acceptBtn.title = 'Keep this note';
			acceptBtn.addEventListener('click', async () => {
				await this.editManager.resolveNewNote(ctx.sourcePath, data.id, 'accept');
				this.notifyEditFeedback(ctx.sourcePath, 'accept');
			});

		} catch (e) {
			this.logger.error('PARSE', 'Failed to parse ai-new-note block', e);
			el.createDiv({ cls: 'ai-edit-error', text: 'Invalid new note block' });
		}
	}

	// Delegated to EditManager
	async processNextEdit(action: 'accept' | 'reject') {
		return this.editManager.processNextEdit(action);
	}

	// Delegated to EditManager
	async batchProcessEdits(action: 'accept' | 'reject') {
		return this.editManager.batchProcessEdits(action);
	}

	// Show all files with pending edits (UI logic stays in main.ts, uses EditManager helpers)
	async showPendingEdits() {
		const files = this.app.vault.getMarkdownFiles();
		const filesWithEdits: { file: TFile; count: number }[] = [];

		for (const file of files) {
			const content = await this.app.vault.read(file);
			const edits = this.editManager.extractEditsFromContent(content);
			const newNoteIds = this.editManager.extractNewNoteIdsFromContent(content);
			const totalCount = edits.length + newNoteIds.length;
			if (totalCount > 0) {
				filesWithEdits.push({ file, count: totalCount });
			}
		}

		if (filesWithEdits.length === 0) {
			new Notice('No pending edits found');
			return;
		}

		// Show modal with list
		new PendingEditsModal(this.app, filesWithEdits).open();
	}

	// Open Obsidian's search with a specific query
	openSearchWithQuery(query: string) {
		// Access the global search plugin
		const searchPlugin = (this.app as any).internalPlugins?.getPluginById('global-search');
		if (searchPlugin && searchPlugin.enabled) {
			const searchView = searchPlugin.instance;
			if (searchView && searchView.openGlobalSearch) {
				searchView.openGlobalSearch(query);
				return;
			}
		}

		// Fallback: try to open search leaf directly
		const searchLeaf = this.app.workspace.getLeavesOfType('search')[0];
		if (searchLeaf) {
			this.app.workspace.revealLeaf(searchLeaf);
			const searchViewInstance = searchLeaf.view as any;
			if (searchViewInstance && searchViewInstance.setQuery) {
				searchViewInstance.setQuery(query);
			}
		} else {
			new Notice('Could not open search. Please search manually for: ' + query);
		}
	}

	// Delegated to EditManager
	async insertEditBlocks(validatedEdits: ValidatedEdit[]): Promise<{ success: number; failed: number }> {
		return this.editManager.insertEditBlocks(validatedEdits);
	}

	/**
	 * Format a note's content for inclusion in context.
	 * Strips pending edit blocks, adds line numbers, wraps in FILE markers.
	 */
	formatNoteForContext(content: string, fileName: string, label: string): string {
		const clean = stripPendingEditBlocks(content, this.settings.pendingEditTag);
		return `--- FILE: "${fileName}" (${label}) ---\n${addLineNumbers(clean)}\n--- END FILE ---\n`;
	}

	// Context building methods - new version using ContextScopeConfig
	async buildContextWithScopeConfig(file: TFile, task: string, scopeConfig: ContextScopeConfig): Promise<string> {
		this.logger.log('CONTEXT', 'Building context', {
			currentFile: file.path,
			scopeConfig,
			excludedFolders: this.settings.excludedFolders
		});

		// Clear semantic cache at start of each context build
		this.lastSemanticFilePaths.clear();

		const parts: string[] = [];

		parts.push(CONTEXT_TASK_HEADER);
		parts.push(task);
		parts.push(CONTEXT_TASK_FOOTER);
		parts.push('');
		parts.push(CONTEXT_DATA_HEADER);
		parts.push('');

		// Only include current file if not excluded
		let currentContent = '';
		if (!this.isFileExcluded(file)) {
			currentContent = await this.app.vault.cachedRead(file);
			parts.push(this.formatNoteForContext(currentContent, file.name, `Current Note: "${file.basename}"`));
		}

		const seenFiles = new Set<string>();
		seenFiles.add(file.path);

		// Get linked files based on depth using BFS (with maxLinkedNotes limit)
		if (scopeConfig.linkDepth > 0 && scopeConfig.maxLinkedNotes > 0) {
			const linkedFiles = this.getLinkedFilesBFS(file, scopeConfig.linkDepth);
			const limitedLinked = [...linkedFiles].slice(0, scopeConfig.maxLinkedNotes);
			for (const linkedPath of limitedLinked) {
				if (!seenFiles.has(linkedPath)) {
					seenFiles.add(linkedPath);
					const linkedFile = this.app.vault.getAbstractFileByPath(linkedPath);
					if (linkedFile instanceof TFile) {
						const content = await this.app.vault.cachedRead(linkedFile);
						parts.push(this.formatNoteForContext(content, linkedFile.name, `Linked Note: "${linkedFile.basename}"`));
					}
				}
			}
		}

		// Add folder files if maxFolderNotes > 0 (additive, independent of link depth)
		if (scopeConfig.maxFolderNotes > 0) {
			const folderFiles = this.getSameFolderFiles(file);
			const limitedFolder = [...folderFiles].slice(0, scopeConfig.maxFolderNotes);
			for (const folderPath of limitedFolder) {
				if (!seenFiles.has(folderPath)) {
					seenFiles.add(folderPath);
					const folderFile = this.app.vault.getAbstractFileByPath(folderPath);
					if (folderFile instanceof TFile) {
						const content = await this.app.vault.cachedRead(folderFile);
						parts.push(this.formatNoteForContext(content, folderFile.name, `Folder Note: "${folderFile.basename}"`));
					}
				}
			}
		}

		// Add semantic matches if semanticMatchCount > 0
		if (scopeConfig.semanticMatchCount > 0 && this.embeddingIndex) {
			try {
				// Build query from current content and task
				const queryText = currentContent + '\n\n' + task;
				const queryEmbedding = await generateEmbedding(
					queryText.substring(0, 8000), // Limit query size
					this.settings.openaiApiKey,
					this.settings.embeddingModel
				);

				// Convert percentage to 0-1 range for threshold
				const minSimilarity = scopeConfig.semanticMinSimilarity / 100;
				const matches = searchSemantic(
					queryEmbedding,
					this.embeddingIndex,
					seenFiles,
					scopeConfig.semanticMatchCount,
					minSimilarity
				);

				for (const match of matches) {
					const semanticFile = this.app.vault.getAbstractFileByPath(match.notePath);
					if (semanticFile instanceof TFile) {
						seenFiles.add(match.notePath);
						// Cache semantic file path for editable scope enforcement
						this.lastSemanticFilePaths.add(match.notePath);
						const content = await this.app.vault.cachedRead(semanticFile);
						const scorePercent = (match.score * 100).toFixed(0);
						parts.push(this.formatNoteForContext(content, semanticFile.name, `Semantic Match: "${semanticFile.basename}", ${scorePercent}% similar`));
					}
				}
			} catch (error) {
				this.logger.error('SEMANTIC', 'Failed to get semantic matches', error);
				// Continue without semantic matches
			}
		}

		// Add manually added notes
		if (scopeConfig.manuallyAddedNotes && scopeConfig.manuallyAddedNotes.length > 0) {
			for (const manualPath of scopeConfig.manuallyAddedNotes) {
				if (!seenFiles.has(manualPath)) {
					seenFiles.add(manualPath);
					const manualFile = this.app.vault.getAbstractFileByPath(manualPath);
					if (manualFile instanceof TFile && !this.isFileExcluded(manualFile)) {
						const content = await this.app.vault.cachedRead(manualFile);
						parts.push(this.formatNoteForContext(content, manualFile.name, `Manually Added: "${manualFile.basename}"`));
					}
				}
			}
		}

		parts.push(CONTEXT_DATA_FOOTER);

		const contextString = parts.join('\n');
		this.logger.log('CONTEXT', 'Context building completed', {
			totalFiles: seenFiles.size,
			contextLength: contextString.length,
			estimatedTokens: this.estimateTokens(contextString)
		});

		return contextString;
	}

	/**
	 * Build context with token limit enforcement.
	 * Notes are removed in priority order if the limit is exceeded:
	 * 1. Manual notes (first to remove)
	 * 2. Semantic notes
	 * 3. Folder notes
	 * 4. Linked notes (furthest depth first)
	 * 5. Current note (NEVER removed)
	 */
	async buildContextWithTokenLimit(
		file: TFile,
		task: string,
		scopeConfig: ContextScopeConfig,
		tokenLimit: number,
		capabilities: AICapabilities,
		editableScope: EditableScope,
		chatHistoryTokens: number
	): Promise<TokenLimitedContextResult> {
		// Calculate fixed overhead
		const systemPrompt = this.buildEditSystemPrompt(capabilities, editableScope);
		const systemPromptTokens = this.estimateTokens(systemPrompt);
		const responseBuffer = 500; // Reserve tokens for response
		const overhead = systemPromptTokens + chatHistoryTokens + responseBuffer;
		const availableForContext = Math.max(0, tokenLimit - overhead);

		// Collect all notes with their content and metadata
		interface NoteEntry {
			path: string;
			content: string;
			tokens: number;
			priority: number; // Higher = more important (less likely to remove)
			label: string;
		}

		const noteEntries: NoteEntry[] = [];
		const seenFiles = new Set<string>();

		// Priority levels (higher = more important)
		const PRIORITY_CURRENT = 1000;
		const PRIORITY_LINKED_DEPTH_1 = 100;
		const PRIORITY_LINKED_DEPTH_2 = 90;
		const PRIORITY_LINKED_DEPTH_3 = 80;
		const PRIORITY_FOLDER = 50;
		const PRIORITY_SEMANTIC = 30;
		const PRIORITY_MANUAL = 10;

		// 1. Add current note (NEVER removed - highest priority)
		if (!this.isFileExcluded(file)) {
			const content = await this.app.vault.cachedRead(file);
			const formattedContent = this.formatNoteForContext(content, file.name, `Current Note: "${file.basename}"`);
			noteEntries.push({
				path: file.path,
				content: formattedContent,
				tokens: this.estimateTokens(formattedContent),
				priority: PRIORITY_CURRENT,
				label: 'Current Note'
			});
			seenFiles.add(file.path);
		}

		// 2. Add linked files by depth (higher depth = lower priority)
		if (scopeConfig.linkDepth > 0 && scopeConfig.maxLinkedNotes > 0) {
			// Get links at each depth level separately for priority assignment
			for (let depth = 1; depth <= scopeConfig.linkDepth; depth++) {
				const linkedAtDepth = this.getLinkedFilesBFS(file, depth);
				const prevDepthLinked = depth > 1 ? this.getLinkedFilesBFS(file, depth - 1) : new Set<string>();

				// Get only files at exactly this depth (not at shallower depths)
				const onlyThisDepth = [...linkedAtDepth].filter(p => !prevDepthLinked.has(p));

				let priority: number;
				switch (depth) {
					case 1: priority = PRIORITY_LINKED_DEPTH_1; break;
					case 2: priority = PRIORITY_LINKED_DEPTH_2; break;
					default: priority = PRIORITY_LINKED_DEPTH_3; break;
				}

				for (const linkedPath of onlyThisDepth) {
					if (!seenFiles.has(linkedPath) && noteEntries.length < scopeConfig.maxLinkedNotes + 1) {
						seenFiles.add(linkedPath);
						const linkedFile = this.app.vault.getAbstractFileByPath(linkedPath);
						if (linkedFile instanceof TFile) {
							const content = await this.app.vault.cachedRead(linkedFile);
							const formattedContent = this.formatNoteForContext(content, linkedFile.name, `Linked Note: "${linkedFile.basename}"`);
							noteEntries.push({
								path: linkedPath,
								content: formattedContent,
								tokens: this.estimateTokens(formattedContent),
								priority,
								label: `Linked (depth ${depth})`
							});
						}
					}
				}
			}
		}

		// 3. Add folder files
		if (scopeConfig.maxFolderNotes > 0) {
			const folderFiles = this.getSameFolderFiles(file);
			const limitedFolder = [...folderFiles].slice(0, scopeConfig.maxFolderNotes);
			for (const folderPath of limitedFolder) {
				if (!seenFiles.has(folderPath)) {
					seenFiles.add(folderPath);
					const folderFile = this.app.vault.getAbstractFileByPath(folderPath);
					if (folderFile instanceof TFile) {
						const content = await this.app.vault.cachedRead(folderFile);
						const formattedContent = this.formatNoteForContext(content, folderFile.name, `Folder Note: "${folderFile.basename}"`);
						noteEntries.push({
							path: folderPath,
							content: formattedContent,
							tokens: this.estimateTokens(formattedContent),
							priority: PRIORITY_FOLDER,
							label: 'Folder'
						});
					}
				}
			}
		}

		// 4. Add semantic matches
		if (scopeConfig.semanticMatchCount > 0 && this.embeddingIndex) {
			try {
				const currentContent = await this.app.vault.cachedRead(file);
				const queryText = currentContent + '\n\n' + task;
				const queryEmbedding = await generateEmbedding(
					queryText.substring(0, 8000),
					this.settings.openaiApiKey,
					this.settings.embeddingModel
				);

				const minSimilarity = scopeConfig.semanticMinSimilarity / 100;
				const matches = searchSemantic(
					queryEmbedding,
					this.embeddingIndex,
					seenFiles,
					scopeConfig.semanticMatchCount,
					minSimilarity
				);

				for (const match of matches) {
					const semanticFile = this.app.vault.getAbstractFileByPath(match.notePath);
					if (semanticFile instanceof TFile) {
						seenFiles.add(match.notePath);
						this.lastSemanticFilePaths.add(match.notePath);
						const content = await this.app.vault.cachedRead(semanticFile);
						const scorePercent = (match.score * 100).toFixed(0);
						const formattedContent = this.formatNoteForContext(content, semanticFile.name, `Semantic Match: "${semanticFile.basename}", ${scorePercent}% similar`);
						noteEntries.push({
							path: match.notePath,
							content: formattedContent,
							tokens: this.estimateTokens(formattedContent),
							priority: PRIORITY_SEMANTIC,
							label: 'Semantic'
						});
					}
				}
			} catch (error) {
				this.logger.error('SEMANTIC', 'Failed to get semantic matches', error);
			}
		}

		// 5. Add manually added notes (lowest priority for removal)
		if (scopeConfig.manuallyAddedNotes && scopeConfig.manuallyAddedNotes.length > 0) {
			for (const manualPath of scopeConfig.manuallyAddedNotes) {
				if (!seenFiles.has(manualPath)) {
					seenFiles.add(manualPath);
					const manualFile = this.app.vault.getAbstractFileByPath(manualPath);
					if (manualFile instanceof TFile && !this.isFileExcluded(manualFile)) {
						const content = await this.app.vault.cachedRead(manualFile);
						const formattedContent = this.formatNoteForContext(content, manualFile.name, `Manually Added: "${manualFile.basename}"`);
						noteEntries.push({
							path: manualPath,
							content: formattedContent,
							tokens: this.estimateTokens(formattedContent),
							priority: PRIORITY_MANUAL,
							label: 'Manual'
						});
					}
				}
			}
		}

		// Calculate total tokens and remove notes if necessary
		const taskHeader = CONTEXT_TASK_HEADER + '\n' + task + '\n' + CONTEXT_TASK_FOOTER + '\n\n';
		const dataHeader = CONTEXT_DATA_HEADER + '\n\n';
		const dataFooter = CONTEXT_DATA_FOOTER;
		const headerTokens = this.estimateTokens(taskHeader + dataHeader + dataFooter);

		let totalContentTokens = noteEntries.reduce((sum, e) => sum + e.tokens, 0);
		const removedNotes: string[] = [];

		// Sort by priority ascending (lowest priority first for removal)
		const sortedForRemoval = [...noteEntries].sort((a, b) => a.priority - b.priority);

		// Remove notes until we're under the limit (never remove current note)
		while (totalContentTokens + headerTokens > availableForContext && sortedForRemoval.length > 1) {
			// Find lowest priority note that isn't the current note
			const toRemoveIndex = sortedForRemoval.findIndex(e => e.priority < PRIORITY_CURRENT);
			if (toRemoveIndex === -1) break; // Only current note left

			const removed = sortedForRemoval.splice(toRemoveIndex, 1)[0];
			totalContentTokens -= removed.tokens;
			removedNotes.push(removed.path);

			this.logger.log('TOKEN_LIMIT', `Removed note due to token limit`, {
				path: removed.path,
				tokens: removed.tokens,
				priority: removed.priority,
				label: removed.label
			});
		}

		// Build final context from remaining notes
		const remainingNotes = noteEntries.filter(e => !removedNotes.includes(e.path));
		// Sort remaining by priority descending (current note first, then by importance)
		remainingNotes.sort((a, b) => b.priority - a.priority);

		const contextParts: string[] = [taskHeader, dataHeader];
		for (const note of remainingNotes) {
			contextParts.push(note.content);
		}
		contextParts.push(dataFooter);

		const finalContext = contextParts.join('');

		return {
			context: finalContext,
			removedNotes,
			totalTokens: this.estimateTokens(finalContext) + overhead
		};
	}

	// Get context note count using ContextScopeConfig
	async getContextNoteCountWithConfig(file: TFile, scopeConfig: ContextScopeConfig): Promise<{ included: number; excluded: number }> {
		let included = 0;
		let excluded = 0;

		const seenFiles = new Set<string>();

		// Current file
		seenFiles.add(file.path);
		if (this.isFileExcluded(file)) {
			excluded++;
		} else {
			included++;
		}

		// Count linked files based on depth (maxLinkedNotes 0 = none)
		if (scopeConfig.linkDepth > 0 && scopeConfig.maxLinkedNotes > 0) {
			const linkedFiles = this.getLinkedFilesBFS(file, scopeConfig.linkDepth);
			const limitedLinked = [...linkedFiles].slice(0, scopeConfig.maxLinkedNotes);
			for (const linkedPath of limitedLinked) {
				if (!seenFiles.has(linkedPath)) {
					seenFiles.add(linkedPath);
					const linkedFile = this.app.vault.getAbstractFileByPath(linkedPath);
					if (linkedFile instanceof TFile) {
						// Note: BFS already excludes files in excluded folders, so these are all included
						included++;
					}
				}
			}
		}

		// Count folder files if maxFolderNotes > 0
		if (scopeConfig.maxFolderNotes > 0) {
			const folderFiles = this.getSameFolderFiles(file);
			const limitedFolder = [...folderFiles].slice(0, scopeConfig.maxFolderNotes);
			for (const folderPath of limitedFolder) {
				if (!seenFiles.has(folderPath)) {
					seenFiles.add(folderPath);
					// getSameFolderFiles already excludes excluded files
					included++;
				}
			}
		}

		// Count semantic matches if semanticMatchCount > 0
		if (scopeConfig.semanticMatchCount > 0 && this.embeddingIndex) {
			try {
				const currentContent = await this.app.vault.cachedRead(file);
				const queryEmbedding = await generateEmbedding(
					currentContent.substring(0, 5000),
					this.settings.openaiApiKey,
					this.settings.embeddingModel
				);

				// Convert percentage to 0-1 range for threshold
				const minSimilarity = scopeConfig.semanticMinSimilarity / 100;
				const matches = searchSemantic(
					queryEmbedding,
					this.embeddingIndex,
					seenFiles,
					scopeConfig.semanticMatchCount,
					minSimilarity
				);

				for (const match of matches) {
					if (!seenFiles.has(match.notePath)) {
						seenFiles.add(match.notePath);
						included++;
					}
				}
			} catch (error) {
				// Continue without semantic matches
				this.logger.warn('SEMANTIC', 'Failed to count semantic matches', error);
			}
		}

		// Count manually added notes
		if (scopeConfig.manuallyAddedNotes && scopeConfig.manuallyAddedNotes.length > 0) {
			for (const path of scopeConfig.manuallyAddedNotes) {
				if (!seenFiles.has(path)) {
					seenFiles.add(path);
					included++;
				}
			}
		}

		return { included, excluded };
	}

	// addLineNumbers is now imported from src/ai/context.ts

	/**
	 * Build or retrieve cached backlink index
	 * Returns Map<targetPath, sourcePaths[]>
	 */
	private getOrBuildBacklinkIndex(): Map<string, string[]> {
		const now = Date.now();

		// Return cached index if still valid
		if (this.backlinkIndex && (now - this.backlinkIndexTimestamp) < this.BACKLINK_CACHE_TTL_MS) {
			return this.backlinkIndex;
		}

		// Build new index
		const resolvedLinks = this.app.metadataCache.resolvedLinks;
		if (!resolvedLinks) {
			this.logger.warn('INDEX', 'resolvedLinks unavailable, metadata cache may not be ready');
			return new Map();
		}

		const index = new Map<string, string[]>();

		for (const [sourcePath, links] of Object.entries(resolvedLinks)) {
			for (const targetPath of Object.keys(links)) {
				if (!index.has(targetPath)) {
					index.set(targetPath, []);
				}
				index.get(targetPath)!.push(sourcePath);
			}
		}

		this.backlinkIndex = index;
		this.backlinkIndexTimestamp = now;

		this.logger.log('INDEX', 'Built backlink index', {
			uniqueTargets: index.size,
			totalLinks: [...index.values()].reduce((sum, arr) => sum + arr.length, 0)
		});

		return index;
	}

	getBacklinkPaths(file: TFile): string[] {
		const index = this.getOrBuildBacklinkIndex();
		const backlinks = index.get(file.path) || [];

		this.logger.log('INDEX', `getBacklinkPaths for ${file.path}`, {
			backlinkCount: backlinks.length,
			cacheHit: this.backlinkIndex !== null
		});

		return backlinks;
	}

	// BFS link traversal for multi-depth context resolution
	// Excluded folders act as WALLS: files in them are excluded AND their links are not followed
	getLinkedFilesBFS(startFile: TFile, maxDepth: number): Set<string> {
		this.logger.log('INDEX', 'BFS traversal started', {
			startFile: startFile.path,
			maxDepth
		});

		const result = new Set<string>();
		const visited = new Set<string>();
		const queue: Array<{ file: TFile; depth: number }> = [];
		let excludedWallsHit = 0;
		let cacheMissCount = 0;

		// Check if starting file is excluded
		if (this.isFileExcluded(startFile)) {
			this.logger.log('INDEX', 'Starting file is in excluded folder, returning empty set', {
				startFile: startFile.path
			});
			return result;
		}

		// Start with the initial file
		visited.add(startFile.path);
		queue.push({ file: startFile, depth: 0 });

		while (queue.length > 0) {
			const { file, depth } = queue.shift()!;

			// Check if file is in excluded folder (acts as a wall)
			if (this.isFileExcluded(file)) {
				excludedWallsHit++;
				continue; // Don't add to result AND don't follow its links
			}

			// Add to result (except the starting file at depth 0)
			if (depth > 0) {
				result.add(file.path);
			}

			// Don't traverse beyond max depth
			if (depth >= maxDepth) {
				continue;
			}

			// Get outgoing links
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache) {
				cacheMissCount++;
				this.logger.warn('INDEX', `getFileCache returned null for ${file.path}, metadata may not be ready`);
			}
			for (const link of cache?.links ?? []) {
				const linkedFile = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path);
				if (linkedFile && linkedFile instanceof TFile && !visited.has(linkedFile.path)) {
					visited.add(linkedFile.path);
					queue.push({ file: linkedFile, depth: depth + 1 });
				}
			}

			// Get backlinks
			for (const sourcePath of this.getBacklinkPaths(file)) {
				if (!visited.has(sourcePath)) {
					const backlinkFile = this.app.vault.getAbstractFileByPath(sourcePath);
					if (backlinkFile instanceof TFile) {
						visited.add(sourcePath);
						queue.push({ file: backlinkFile, depth: depth + 1 });
					}
				}
			}
		}

		this.logger.log('INDEX', 'BFS traversal completed', {
			startFile: startFile.path,
			maxDepth,
			resultCount: result.size,
			visitedCount: visited.size,
			excludedWallsHit,
			cacheMissCount
		});

		return result;
	}

	// Get files from same folder (excluding the current file)
	getSameFolderFiles(file: TFile): Set<string> {
		const result = new Set<string>();
		const folderPath = file.parent?.path || '';
		const allFiles = this.app.vault.getMarkdownFiles();

		for (const f of allFiles) {
			const fFolderPath = f.parent?.path || '';
			if (fFolderPath === folderPath && f.path !== file.path && !this.isFileExcluded(f)) {
				result.add(f.path);
			}
		}

		return result;
	}

	// Build system prompt for Edit mode - delegates to shared buildTaskAgentSystemPrompt
	buildEditSystemPrompt(capabilities: AICapabilities, editableScope: EditableScope): string {
		return buildTaskAgentSystemPrompt(
			capabilities,
			editableScope,
			{ character: this.settings.customInstructions }
		);
	}

	estimateTokens(text: string): number {
		return Math.ceil(text.length / 4);
	}

	isNotePrivate(filePath: string): boolean {
		const tag = this.settings.excludedTag;
		if (!tag) return false;
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return false;
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache) return false;
		const normalizedTag = tag.replace(/^#/, '');
		const fmTags = cache.frontmatter?.tags;
		if (Array.isArray(fmTags) && fmTags.some((t: string) => t.replace(/^#/, '') === normalizedTag)) return true;
		if (cache.tags?.some(t => t.tag.replace(/^#/, '') === normalizedTag)) return true;
		return false;
	}

	isFileExcluded(file: TFile): boolean {
		return isFileExcluded(file.path, this.settings.excludedFolders) || this.isNotePrivate(file.path);
	}

	isPathExcluded(filePath: string): boolean {
		return isFileExcluded(filePath, this.settings.excludedFolders) || this.isNotePrivate(filePath);
	}

	async validateEdits(edits: EditInstruction[]): Promise<ValidatedEdit[]> {
		this.logger.log('VALIDATE', 'Starting edit validation', {
			editCount: edits.length,
			edits: edits.map(e => ({ file: e.file, position: e.position }))
		});

		const validated: ValidatedEdit[] = [];

		for (const instruction of edits) {
			const validatedEdit: ValidatedEdit = {
				instruction,
				resolvedFile: null,
				currentContent: '',
				newContent: '',
				error: null,
				isNewFile: false
			};

			if (instruction.position === 'create') {
				if (!instruction.file.endsWith('.md')) {
					validatedEdit.error = `New file must have .md extension: ${instruction.file}`;
					validated.push(validatedEdit);
					continue;
				}

				// Check if path is in excluded folder
				if (this.isPathExcluded(instruction.file)) {
					validatedEdit.error = `Cannot create file in excluded folder: ${instruction.file}`;
					validated.push(validatedEdit);
					continue;
				}

				const existingFile = this.app.vault.getAbstractFileByPath(instruction.file);
				if (existingFile) {
					validatedEdit.error = `File already exists: ${instruction.file}`;
					validated.push(validatedEdit);
					continue;
				}

				validatedEdit.isNewFile = true;
				validatedEdit.currentContent = '';
				validatedEdit.newContent = instruction.content;
				validated.push(validatedEdit);
				continue;
			}

			const files = this.app.vault.getMarkdownFiles();
			const matchingFile = files.find(f =>
				f.path === instruction.file ||
				f.path.endsWith('/' + instruction.file) ||
				f.name === instruction.file
			);

			if (!matchingFile) {
				validatedEdit.error = `File not found: ${instruction.file}`;
				validated.push(validatedEdit);
				continue;
			}

			validatedEdit.resolvedFile = matchingFile;

			// Check if file is in excluded folder
			if (this.isFileExcluded(matchingFile)) {
				validatedEdit.error = `Cannot edit file in excluded folder: ${matchingFile.path}`;
				validated.push(validatedEdit);
				continue;
			}

			try {
				const rawContent = await this.app.vault.cachedRead(matchingFile);
				// Strip pending edit blocks so line numbers match what the AI sees
				validatedEdit.currentContent = stripPendingEditBlocks(rawContent, this.settings.pendingEditTag);
			} catch (e) {
				validatedEdit.error = `Could not read file: ${(e as Error).message}`;
				validated.push(validatedEdit);
				continue;
			}

			const result = computeNewContent(validatedEdit.currentContent, instruction);
			if (result.error) {
				validatedEdit.error = result.error;
			} else {
				validatedEdit.newContent = result.content;
			}

			validated.push(validatedEdit);
		}

		const validCount = validated.filter(e => !e.error).length;
		const errorCount = validated.filter(e => e.error).length;
		this.logger.log('VALIDATE', 'Edit validation completed', {
			total: validated.length,
			valid: validCount,
			errors: errorCount,
			errorDetails: validated.filter(e => e.error).map(e => ({
				file: e.instruction.file,
				error: e.error
			}))
		});

		return validated;
	}

	// New version using ContextScopeConfig
	filterEditsByRulesWithConfig(
		validatedEdits: ValidatedEdit[],
		currentFile: TFile,
		editableScope: EditableScope,
		capabilities: AICapabilities,
		scopeConfig: ContextScopeConfig,
		scoutSelectedPaths?: string[]
	): ValidatedEdit[] {
		this.logger.log('FILTER', 'Starting rule-based filtering', {
			editCount: validatedEdits.length,
			currentFile: currentFile.path,
			editableScope,
			capabilities,
			scoutSelectedPaths: scoutSelectedPaths?.length || 0
		});

		// Build set of allowed file paths based on editableScope (include Scout-selected paths)
		const allowedFiles = this.getEditableFilesWithConfig(currentFile, editableScope, scopeConfig, scoutSelectedPaths);

		this.logger.log('FILTER', 'Allowed files for editing', summarizeSet(allowedFiles, 5));

		const rejectedEdits: Array<{ file: string; reason: string }> = [];

		for (const edit of validatedEdits) {
			if (edit.error) continue; // Already has error

			// 1. CHECK EDITABLE SCOPE
			const targetPath = edit.resolvedFile?.path || edit.instruction.file;
			if (!allowedFiles.has(targetPath) && !edit.isNewFile) {
				edit.error = `File "${edit.instruction.file}" is outside editable scope (mode: ${editableScope}). Only the currently open note can be edited. The user can change this in Settings → Editable Scope.`;
				rejectedEdits.push({ file: edit.instruction.file, reason: 'outside editable scope' });
				continue;
			}

			// 2. CHECK CAPABILITIES
			const position = edit.instruction.position;

			// Check canCreate
			if (edit.isNewFile && !capabilities.canCreate) {
				edit.error = 'Creating new files is not allowed. The user can enable "Can Create" in Settings → Edit Rules.';
				rejectedEdits.push({ file: edit.instruction.file, reason: 'canCreate disabled' });
				continue;
			}

			// Check canDelete
			if ((position.startsWith('delete:') || position.startsWith('replace:')) && !capabilities.canDelete) {
				edit.error = 'Deleting/replacing content is not allowed. Only additive edits (insert, append) are permitted. The user can enable "Can Delete" in Settings → Edit Rules.';
				rejectedEdits.push({ file: edit.instruction.file, reason: 'canDelete disabled' });
				continue;
			}

			// Check canAdd
			if ((position === 'start' || position === 'end' ||
				position.startsWith('after:') || position.startsWith('insert:')) && !capabilities.canAdd) {
				edit.error = 'Adding/inserting content is not allowed. Only replacements and deletions are permitted. The user can enable "Can Add" in Settings → Edit Rules.';
				rejectedEdits.push({ file: edit.instruction.file, reason: 'canAdd disabled' });
				continue;
			}

			// Check canNavigate
			if (position === 'open' && !capabilities.canNavigate) {
				edit.error = 'Opening notes in new tabs is not allowed. The user can enable "Can Navigate" in Settings → Edit Rules.';
				rejectedEdits.push({ file: edit.instruction.file, reason: 'canNavigate disabled' });
				continue;
			}
		}

		const passedCount = validatedEdits.filter(e => !e.error).length;
		this.logger.log('FILTER', 'Rule-based filtering completed', {
			total: validatedEdits.length,
			passed: passedCount,
			rejected: rejectedEdits.length,
			rejectedEdits
		});

		return validatedEdits;
	}

	// New version using ContextScopeConfig
	getEditableFilesWithConfig(currentFile: TFile, editableScope: EditableScope, scopeConfig: ContextScopeConfig, scoutSelectedPaths?: string[]): Set<string> {
		const allowed = new Set<string>();
		allowed.add(currentFile.path);

		if (editableScope === 'current') {
			return allowed; // Only current file
		}

		// editableScope === 'vault' — all markdown files are editable
		const files = this.app.vault.getMarkdownFiles();
		for (const f of files) {
			if (!this.isPathExcluded(f.path)) {
				allowed.add(f.path);
			}
		}

		return allowed;
	}

	// computeNewContent is now imported from src/ai/validation.ts
}

// ObsidianAgent Sidebar View
class AIAssistantView extends ItemView {
	plugin: MyPlugin;

	// State - new context scope config (initialized from settings in onOpen)
	contextScopeConfig: ContextScopeConfig = {
		linkDepth: 1,
		maxLinkedNotes: 20,
		maxFolderNotes: 0,
		semanticMatchCount: 0,
		semanticMinSimilarity: 50
	};
	// Edit rules - initialized from settings in onOpen
	editableScope: EditableScope = 'vault';
	capabilities: AICapabilities = {
		canAdd: true,
		canDelete: true,
		canCreate: true,
		canNavigate: true
	};
	taskText = '';
	isLoading = false;
	chatMessages: ChatMessage[] = [];
	lastActiveFilePath: string | null = null;
	// Agent abort controller for cancellation
	private agentAbortController: AbortController | null = null;
	// Pending agent state for ask_user resumption
	private pendingAgentState: {
		resumeState: string;
		userMessage: string;
	} | null = null;

	// UI refs
	private chatContainer: HTMLDivElement | null = null;
	private contextDetails: HTMLDetailsElement | null = null;
	private contextSummary: HTMLSpanElement | null = null;
	private taskTextarea: HTMLTextAreaElement | null = null;
	private submitButton: HTMLButtonElement | null = null;
	private stopButton: HTMLButtonElement | null = null;
	private welcomeMessage: HTMLDivElement | null = null;
	// Slider elements (for live sync from settings)
	private depthSlider: HTMLInputElement | null = null;
	private maxLinkedSlider: HTMLInputElement | null = null;
	private maxFolderSlider: HTMLInputElement | null = null;
	private semanticCountSlider: HTMLInputElement | null = null;
	private semanticSimilaritySlider: HTMLInputElement | null = null;
	// Slider labels
	private maxLinkedLabel: HTMLSpanElement | null = null;
	private depthValueLabel: HTMLSpanElement | null = null;
	private maxFolderLabel: HTMLSpanElement | null = null;
	private semanticCountLabel: HTMLSpanElement | null = null;
	private semanticSimilarityLabel: HTMLSpanElement | null = null;
	private semanticWarningEl: HTMLDivElement | null = null;
	private semanticSectionEl: HTMLDivElement | null = null;
	// Agent progress UI refs
	private agentProgressContainer: HTMLDivElement | null = null;
	// Manual notes picker
	private manualNotesContainer: HTMLDivElement | null = null;
	// User clarification UI (for ask_user tool)
	private clarificationContainer: HTMLDivElement | null = null;
	// Pending copy notes data (stored between callback and bubble render)
	private pendingCopyContent: string = '';
	private pendingCopyPaths: string[] = [];

	constructor(leaf: WorkspaceLeaf, plugin: MyPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return AI_ASSISTANT_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'ObsidianAgent';
	}

	getIcon(): string {
		return 'brain';
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('ai-assistant-view');

		// Initialize context scope config from settings defaults
		this.contextScopeConfig = {
			linkDepth: this.plugin.settings.defaultLinkDepth as LinkDepth,
			maxLinkedNotes: this.plugin.settings.defaultMaxLinkedNotes,
			maxFolderNotes: this.plugin.settings.defaultMaxFolderNotes,
			semanticMatchCount: this.plugin.settings.defaultSemanticMatchCount,
			semanticMinSimilarity: this.plugin.settings.defaultSemanticMinSimilarity
		};

		// Initialize edit rules from settings defaults
		this.editableScope = this.plugin.settings.defaultEditableScope;
		const disabledInit = new Set(this.plugin.settings.disabledTools || []);
		this.capabilities = {
			canAdd: this.plugin.settings.defaultCanAdd,
			canDelete: this.plugin.settings.defaultCanDelete,
			canCreate: !disabledInit.has('create_note'),
			canNavigate: !disabledInit.has('open_note')
		};

		// Chat header with clear button (top-left, fixed above chat)
		const chatHeader = container.createDiv({ cls: 'ai-chat-header' });
		const clearChatBtn = chatHeader.createEl('button', {
			cls: 'ai-assistant-clear-btn',
			attr: { 'aria-label': 'Clear chat history' }
		});
		setIcon(clearChatBtn, 'eraser');
		clearChatBtn.title = 'Clear chat history';
		clearChatBtn.addEventListener('click', () => this.clearChat());

		// Chat container (takes up most space, scrollable)
		this.chatContainer = container.createDiv({ cls: 'ai-chat-container' });

		// Delegated click handler for internal links and tags in chat
		this.registerDomEvent(this.chatContainer, 'click', (evt: MouseEvent) => {
			const target = evt.target as HTMLElement;
			const link = target.closest('a.internal-link') as HTMLAnchorElement | null;
			if (link) {
				evt.preventDefault();
				const href = link.getAttr('href') || link.dataset.href || link.textContent || '';
				if (href) {
					this.app.workspace.openLinkText(href, this.getSourcePath(), true);
				}
				return;
			}
			const tag = target.closest('a.tag') as HTMLAnchorElement | null;
			if (tag) {
				evt.preventDefault();
				const tagText = tag.textContent?.replace(/^#/, '') || '';
				if (tagText) {
					this.plugin.openSearchWithQuery(`tag:#${tagText}`);
				}
				return;
			}
		});

		// Welcome message
		this.welcomeMessage = this.chatContainer.createDiv({ cls: 'ai-chat-welcome' });
		this.welcomeMessage.setText('Ask a question or request edits to your notes.');

		// Bottom section (fixed at bottom)
		const bottomSection = container.createDiv({ cls: 'ai-assistant-bottom-section' });

		// Input row with textarea and submit button
		const inputRow = bottomSection.createDiv({ cls: 'ai-assistant-input-row' });

		this.taskTextarea = inputRow.createEl('textarea', {
			cls: 'ai-assistant-textarea',
			placeholder: 'Enter your message...'
		});
		this.taskTextarea.rows = 2;
		this.taskTextarea.addEventListener('input', () => {
			this.taskText = this.taskTextarea?.value || '';
			this.autoResizeTextarea();
		});
		this.taskTextarea.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				if (this.isLoading) return;
				this.handleSubmit();
			}
		});

		// Submit arrow button
		this.submitButton = inputRow.createEl('button', {
			cls: 'ai-assistant-submit-arrow'
		});
		this.submitButton.textContent = '\u27A4'; // Arrow symbol
		this.submitButton.title = 'Send message';
		this.submitButton.addEventListener('click', () => this.handleSubmit());

		// Stop button (hidden by default, shown during agent execution)
		this.stopButton = inputRow.createEl('button', {
			cls: 'ai-assistant-stop-btn'
		});
		this.stopButton.setText('Stop');
		this.stopButton.title = 'Stop agent execution';
		this.stopButton.style.display = 'none';
		this.stopButton.addEventListener('click', () => this.handleStop());

		// Context Notes toggle
		this.contextDetails = bottomSection.createEl('details', { cls: 'ai-assistant-toggle' });
		this.contextDetails.open = false;
		const contextSummaryEl = this.contextDetails.createEl('summary');
		contextSummaryEl.createSpan({ text: 'Manual Context ' });
		this.contextSummary = contextSummaryEl.createSpan({ cls: 'ai-assistant-context-info' });

		const contextContent = this.contextDetails.createDiv({ cls: 'ai-assistant-toggle-content' });

		contextContent.createEl('p', {
			text: 'This manual context is only referred to by the agent if mentioned in your prompts.',
			cls: 'ai-assistant-context-hint'
		});

		// Helper: create a labeled slider control
		const createSlider = (
			parent: HTMLElement,
			label: string,
			min: number,
			max: number,
			value: number,
			updateLabel: (val: number) => void,
			onChange: (val: number) => void
		): { slider: HTMLInputElement; label: HTMLSpanElement } => {
			const section = parent.createDiv({ cls: 'ai-assistant-slider-section' });
			section.createEl('div', { text: label, cls: 'ai-assistant-section-label' });
			const row = section.createDiv({ cls: 'ai-assistant-slider-row' });
			const slider = row.createEl('input', { type: 'range', cls: 'ai-assistant-depth-slider' });
			slider.min = min.toString();
			slider.max = max.toString();
			slider.value = value.toString();
			const labelEl = row.createSpan({ cls: 'ai-assistant-slider-value' });
			updateLabel(value);
			slider.addEventListener('input', () => {
				const val = parseInt(slider.value, 10);
				onChange(val);
				updateLabel(val);
				this.updateContextSummary();
			});
			return { slider, label: labelEl };
		};

		// Max Linked Notes slider (0-50)
		const maxLinked = createSlider(contextContent, 'Max linked notes:', 0, 50,
			this.contextScopeConfig.maxLinkedNotes,
			(v) => this.updateMaxLinkedLabel(v),
			(v) => { this.contextScopeConfig.maxLinkedNotes = v; }
		);
		this.maxLinkedSlider = maxLinked.slider;
		this.maxLinkedLabel = maxLinked.label;

		// Link depth slider (0-3)
		const depth = createSlider(contextContent, 'Link depth:', 0, 3,
			this.contextScopeConfig.linkDepth,
			(v) => this.updateDepthLabel(v as LinkDepth),
			(v) => { this.contextScopeConfig.linkDepth = v as LinkDepth; }
		);
		this.depthSlider = depth.slider;
		this.depthValueLabel = depth.label;

		// Separator before folder section
		contextContent.createEl('hr', { cls: 'ai-assistant-separator' });

		// Max Folder Notes slider (0-20)
		const maxFolder = createSlider(contextContent, 'Max folder notes:', 0, 20,
			this.contextScopeConfig.maxFolderNotes,
			(v) => this.updateMaxFolderLabel(v),
			(v) => { this.contextScopeConfig.maxFolderNotes = v; }
		);
		this.maxFolderSlider = maxFolder.slider;
		this.maxFolderLabel = maxFolder.label;

		// Semantic search section
		this.semanticSectionEl = contextContent.createDiv({ cls: 'ai-assistant-semantic-section' });

		// Max Semantic Notes slider (0-20)
		const semanticCount = createSlider(this.semanticSectionEl, 'Max semantic notes:', 0, 20,
			this.contextScopeConfig.semanticMatchCount,
			(v) => this.updateSemanticCountLabel(v),
			(v) => { this.contextScopeConfig.semanticMatchCount = v; }
		);
		this.semanticCountSlider = semanticCount.slider;
		this.semanticCountLabel = semanticCount.label;

		// Min Similarity slider (0-100%)
		const semanticSimilarity = createSlider(this.semanticSectionEl, 'Min similarity:', 0, 100,
			this.contextScopeConfig.semanticMinSimilarity,
			(v) => this.updateSemanticSimilarityLabel(v),
			(v) => { this.contextScopeConfig.semanticMinSimilarity = v; }
		);
		this.semanticSimilaritySlider = semanticSimilarity.slider;
		this.semanticSimilarityLabel = semanticSimilarity.label;

		// No index warning (shown if no embeddings)
		this.semanticWarningEl = this.semanticSectionEl.createDiv({ cls: 'ai-assistant-semantic-warning' });
		this.updateSemanticSlidersState();

		// Manually added notes section
		contextContent.createEl('hr', { cls: 'ai-assistant-separator' });
		const manualSection = contextContent.createDiv({ cls: 'ai-assistant-manual-notes-section' });
		manualSection.createEl('div', { text: 'Manually added notes:', cls: 'ai-assistant-section-label' });

		// Container for the list of manually added notes
		this.manualNotesContainer = manualSection.createDiv({ cls: 'ai-assistant-manual-notes-list' });
		this.renderManualNotesList();

		// Add note button
		const addNoteBtn = manualSection.createEl('button', {
			cls: 'ai-assistant-add-note-btn',
			text: '+ Add Note'
		});
		addNoteBtn.addEventListener('click', () => {
			new NotePickerModal(this.app, this.plugin, (file) => {
				this.addManualNote(file.path);
			}).open();
		});

		// Preview button at bottom of toggle content
		const contextPreviewBtn = manualSection.createEl('button', {
			cls: 'ai-assistant-context-preview-btn',
			attr: { 'aria-label': 'Preview context notes' }
		});
		setIcon(contextPreviewBtn, 'list');
		contextPreviewBtn.createSpan({ text: ' View all context notes' });
		contextPreviewBtn.addEventListener('click', () => this.showContextPreview());

		// Note: Edit Rules moved to Settings panel

		// Initial context summary
		await this.updateContextSummary();

		// Listen for active file changes
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				this.handleActiveFileChange();
			})
		);

		// Listen for file renames to update context indicators
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile) {
					this.updateContextIndicatorsForRename(oldPath, file.path, file.basename);
					// Also update lastActiveFilePath if it was the renamed file
					if (this.lastActiveFilePath === oldPath) {
						this.lastActiveFilePath = file.path;
					}
				}
			})
		);

		// Initialize last active file and show initial context
		const initialFile = this.app.workspace.getActiveFile();
		if (initialFile) {
			this.lastActiveFilePath = initialFile.path;
			this.showContextIndicator(initialFile.path, initialFile.basename);
		}

		// Context notes panel visibility depends on enableManualContext setting
		if (this.contextDetails) {
			this.contextDetails.style.display = this.plugin.settings.enableManualContext ? 'block' : 'none';
		}

		// Semantic section visibility depends on enableEmbeddings setting
		if (this.semanticSectionEl) {
			this.semanticSectionEl.style.display = this.plugin.settings.enableEmbeddings ? '' : 'none';
		}
	}

	autoResizeTextarea() {
		if (this.taskTextarea) {
			this.taskTextarea.style.height = 'auto';
			const newHeight = Math.min(this.taskTextarea.scrollHeight, 120);
			this.taskTextarea.style.height = newHeight + 'px';
		}
	}

	updateMaxLinkedLabel(count: number) {
		if (!this.maxLinkedLabel) return;
		this.maxLinkedLabel.setText(count === 0 ? 'None' : `${count} max`);
	}

	updateDepthLabel(depth: LinkDepth) {
		if (!this.depthValueLabel) return;
		const labels = [
			'Current only',
			'Direct links',
			'Links of links',
			'3 hops'
		];
		this.depthValueLabel.setText(labels[depth]);
	}

	updateMaxFolderLabel(count: number) {
		if (!this.maxFolderLabel) return;
		this.maxFolderLabel.setText(count === 0 ? 'None' : `${count} max`);
	}

	updateSemanticCountLabel(count: number) {
		if (!this.semanticCountLabel) return;
		this.semanticCountLabel.setText(count === 0 ? 'None' : `${count} max`);
	}

	updateSemanticSimilarityLabel(percent: number) {
		if (!this.semanticSimilarityLabel) return;
		this.semanticSimilarityLabel.setText(`${percent}%`);
	}

	updateSemanticSlidersState() {
		const hasEmbeddings = !!this.plugin.embeddingIndex;
		if (this.semanticCountSlider) {
			this.semanticCountSlider.disabled = !hasEmbeddings;
			this.semanticCountSlider.style.opacity = hasEmbeddings ? '1' : '0.4';
		}
		if (this.semanticSimilaritySlider) {
			this.semanticSimilaritySlider.disabled = !hasEmbeddings;
			this.semanticSimilaritySlider.style.opacity = hasEmbeddings ? '1' : '0.4';
		}
		if (this.semanticWarningEl) {
			if (!hasEmbeddings) {
				this.semanticWarningEl.setText('Semantic search requires embeddings. Go to settings to reindex.');
				this.semanticWarningEl.style.display = '';
			} else {
				this.semanticWarningEl.style.display = 'none';
			}
		}
	}

	isWebSearchConfigured(): boolean {
		const s = this.plugin.settings;
		if (!s.enableWebSearch) return false;
		if (s.webAgentSearchApi === 'openai') return !!s.openaiApiKey;
		return !!s.webAgentSearchApiKey;
	}

	// Called by plugin when settings change to sync sliders in the view
	onSettingsChanged(changedGroup: 'context' | 'editRules' | 'web') {
		if (changedGroup === 'editRules') {
			const s = this.plugin.settings;
			this.editableScope = s.defaultEditableScope;
			const disabledSet = new Set(s.disabledTools || []);
			this.capabilities = {
				canAdd: s.defaultCanAdd,
				canDelete: s.defaultCanDelete,
				canCreate: !disabledSet.has('create_note'),
				canNavigate: !disabledSet.has('open_note')
			};
		} else if (changedGroup === 'context') {
			const s = this.plugin.settings;
			this.contextScopeConfig.linkDepth = s.defaultLinkDepth as LinkDepth;
			this.contextScopeConfig.maxLinkedNotes = s.defaultMaxLinkedNotes;
			this.contextScopeConfig.maxFolderNotes = s.defaultMaxFolderNotes;
			this.contextScopeConfig.semanticMatchCount = s.defaultSemanticMatchCount;
			this.contextScopeConfig.semanticMinSimilarity = s.defaultSemanticMinSimilarity;

			if (this.depthSlider) {
				this.depthSlider.value = s.defaultLinkDepth.toString();
				this.updateDepthLabel(s.defaultLinkDepth as LinkDepth);
			}
			if (this.maxLinkedSlider) {
				this.maxLinkedSlider.value = s.defaultMaxLinkedNotes.toString();
				this.updateMaxLinkedLabel(s.defaultMaxLinkedNotes);
			}
			if (this.maxFolderSlider) {
				this.maxFolderSlider.value = s.defaultMaxFolderNotes.toString();
				this.updateMaxFolderLabel(s.defaultMaxFolderNotes);
			}
			if (this.semanticCountSlider) {
				this.semanticCountSlider.value = s.defaultSemanticMatchCount.toString();
				this.updateSemanticCountLabel(s.defaultSemanticMatchCount);
			}
			if (this.semanticSimilaritySlider) {
				this.semanticSimilaritySlider.value = s.defaultSemanticMinSimilarity.toString();
				this.updateSemanticSimilarityLabel(s.defaultSemanticMinSimilarity);
			}

			this.updateSemanticSlidersState();
			this.updateContextSummary();

			// Toggle visibility of context panel based on enableManualContext setting
			if (this.contextDetails) {
				this.contextDetails.style.display = s.enableManualContext ? 'block' : 'none';
			}

			// Toggle visibility of semantic section based on enableEmbeddings setting
			if (this.semanticSectionEl) {
				this.semanticSectionEl.style.display = s.enableEmbeddings ? '' : 'none';
			}
		}
	}

	// Handle stop button click
	handleStop() {
		if (this.agentAbortController) {
			this.agentAbortController.abort();
			this.agentAbortController = null;
		}
	}

	// Render the list of manually added notes
	renderManualNotesList() {
		if (!this.manualNotesContainer) return;
		this.manualNotesContainer.empty();

		const manualNotes = this.contextScopeConfig.manuallyAddedNotes || [];
		if (manualNotes.length === 0) {
			const emptyMsg = this.manualNotesContainer.createDiv({ cls: 'ai-assistant-manual-notes-empty' });
			emptyMsg.setText('No notes added');
			return;
		}

		for (const path of manualNotes) {
			const noteItem = this.manualNotesContainer.createDiv({ cls: 'ai-assistant-manual-note-item' });

			// Display note name (filename without extension)
			const noteName = path.split('/').pop()?.replace(/\.md$/, '') || path;
			noteItem.createSpan({ text: noteName, cls: 'ai-assistant-manual-note-name' });

			// Remove button
			const removeBtn = noteItem.createEl('button', {
				cls: 'ai-assistant-manual-note-remove',
				attr: { 'aria-label': 'Remove from context' }
			});
			removeBtn.textContent = '\u00d7'; // × symbol
			removeBtn.addEventListener('click', () => {
				this.removeManualNote(path);
			});
		}
	}

	// Add a note to the manual context list
	addManualNote(path: string) {
		if (!this.contextScopeConfig.manuallyAddedNotes) {
			this.contextScopeConfig.manuallyAddedNotes = [];
		}
		// Avoid duplicates
		if (!this.contextScopeConfig.manuallyAddedNotes.includes(path)) {
			this.contextScopeConfig.manuallyAddedNotes.push(path);
			this.renderManualNotesList();
		}
	}

	// Remove a note from the manual context list
	removeManualNote(path: string) {
		if (!this.contextScopeConfig.manuallyAddedNotes) return;
		const index = this.contextScopeConfig.manuallyAddedNotes.indexOf(path);
		if (index > -1) {
			this.contextScopeConfig.manuallyAddedNotes.splice(index, 1);
			this.renderManualNotesList();
		}
	}

	// Track agent exploration state
	private agentActionsToggle: HTMLDetailsElement | null = null;
	private agentStepsContainer: HTMLDivElement | null = null;
	private currentRoundNumber: number = 0;
	private lastToolStepEl: HTMLDetailsElement | null = null;

	// Show agent progress in chat during exploration
	showAgentProgress(type: string, message: string, detail?: string, fullContent?: string) {
		if (!this.agentStepsContainer) return;

		if (type === 'iteration') {
			// Round headers / separators
			this.currentRoundNumber++;
			if (this.currentRoundNumber > 1) {
				const shortLabel = message.replace('Round ', '');
				const separator = this.agentStepsContainer.createDiv({ cls: 'ai-agent-round-separator' });
				separator.createSpan({ cls: 'ai-agent-round-separator-line' });
				separator.createSpan({ cls: 'ai-agent-round-separator-text', text: shortLabel });
				separator.createSpan({ cls: 'ai-agent-round-separator-line' });
			} else {
				const roundHeader = this.agentStepsContainer.createDiv({ cls: 'ai-agent-round-header' });
				roundHeader.setText(message);
			}
		} else if (type === 'thinking') {
			// Collapsible thinking/reasoning block
			const thinkingEl = this.agentStepsContainer.createEl('details', { cls: 'ai-agent-thinking' });
			thinkingEl.createEl('summary', { text: 'Agent reasoning' });
			const contentEl = thinkingEl.createDiv({ cls: 'ai-agent-thinking-content' });
			if (fullContent) {
				MarkdownRenderer.render(
					this.app,
					fullContent,
					contentEl,
					this.getSourcePath(),
					this
				);
			}
		} else if (type === 'tool_call') {
			// Create expandable tool step (details/summary)
			const detailsEl = this.agentStepsContainer.createEl('details', { cls: 'ai-agent-tool-details' });
			const summaryEl = detailsEl.createEl('summary', { cls: 'ai-agent-progress-step' });
			summaryEl.createSpan({ cls: 'ai-agent-progress-bullet', text: '\u2022' });
			summaryEl.createSpan({ cls: 'ai-agent-progress-text', text: message });
			if (detail) {
				summaryEl.createSpan({ cls: 'ai-agent-progress-detail', text: ` \u2192 ${detail}` });
			}
			summaryEl.createSpan({ cls: 'ai-agent-tool-expand-icon', text: '\u203A' });
			// Store reference so tool_result can attach content
			this.lastToolStepEl = detailsEl;
		} else if (type === 'tool_result') {
			// Attach result content to the last tool step
			if (this.lastToolStepEl && fullContent) {
				const resultEl = this.lastToolStepEl.createDiv({ cls: 'ai-agent-tool-result' });
				// Truncate long results
				const lines = fullContent.split('\n');
				const MAX_LINES = 80;
				if (lines.length > MAX_LINES) {
					resultEl.createEl('pre', { text: lines.slice(0, MAX_LINES).join('\n') + `\n... (${lines.length - MAX_LINES} more lines truncated)` });
				} else {
					resultEl.createEl('pre', { text: fullContent });
				}
				this.lastToolStepEl = null;
			}
		}

		this.scrollChatToBottom();
	}

	// Create the agent progress container in chat
	createAgentProgressContainer(): HTMLDivElement {
		if (!this.chatContainer) {
			throw new Error('Chat container not available');
		}

		// Remove welcome message if exists
		const welcome = this.chatContainer.querySelector('.ai-chat-welcome');
		if (welcome) {
			welcome.remove();
		}

		// Reset state
		this.currentRoundNumber = 0;
		this.lastToolStepEl = null;

		this.agentProgressContainer = this.chatContainer.createDiv({ cls: 'ai-agent-progress-container' });

		const headerEl = this.agentProgressContainer.createDiv({ cls: 'ai-agent-progress-header' });
		headerEl.createSpan({ cls: 'ai-agent-progress-icon', text: '\uD83D\uDD0D' });
		headerEl.createSpan({ cls: 'ai-agent-progress-title', text: ' Agent working...' });

		// Create collapsible actions toggle (starts open during execution)
		this.agentActionsToggle = this.agentProgressContainer.createEl('details', { cls: 'ai-agent-actions-toggle' });
		this.agentActionsToggle.open = true;
		const actionsSummary = this.agentActionsToggle.createEl('summary');
		actionsSummary.setText('Agent actions');

		// Container for actual steps
		this.agentStepsContainer = this.agentActionsToggle.createDiv({ cls: 'ai-agent-steps-container' });

		this.scrollChatToBottom();
		return this.agentProgressContainer;
	}

	// Remove agent progress container
	removeAgentProgress() {
		if (this.agentProgressContainer) {
			this.agentProgressContainer.remove();
			this.agentProgressContainer = null;
		}
	}

	async showContextPreview() {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice('No active file');
			return;
		}

		const contextInfo = await this.buildContextInfo(file);
		new ContextPreviewModal(this.app, contextInfo).open();
	}

	async buildContextInfo(file: TFile): Promise<ContextInfo> {
		const info: ContextInfo = {
			currentNote: file.path,
			linkedNotes: [],
			folderNotes: [],
			semanticNotes: [],
			manualNotes: [],
			totalTokenEstimate: 0,
			frontmatter: new Map()
		};

		const seenFiles = new Set<string>();
		seenFiles.add(file.path);

		// Extract frontmatter for current file
		info.frontmatter!.set(file.path, this.extractFrontmatter(file));

		// Get linked files (maxLinkedNotes 0 = none)
		if (this.contextScopeConfig.linkDepth > 0 && this.contextScopeConfig.maxLinkedNotes > 0) {
			const linkedFiles = this.plugin.getLinkedFilesBFS(file, this.contextScopeConfig.linkDepth);
			const limitedLinked = [...linkedFiles].slice(0, this.contextScopeConfig.maxLinkedNotes);
			for (const path of limitedLinked) {
				seenFiles.add(path);
				info.linkedNotes.push(path);
				// Extract frontmatter for linked files
				const linkedFile = this.app.vault.getAbstractFileByPath(path);
				if (linkedFile instanceof TFile) {
					info.frontmatter!.set(path, this.extractFrontmatter(linkedFile));
				}
			}
		}

		// Get folder files (maxFolderNotes > 0 = include)
		if (this.contextScopeConfig.maxFolderNotes > 0) {
			const folderFiles = this.plugin.getSameFolderFiles(file);
			const limitedFolder = [...folderFiles].slice(0, this.contextScopeConfig.maxFolderNotes);
			for (const path of limitedFolder) {
				if (!seenFiles.has(path)) {
					seenFiles.add(path);
					info.folderNotes.push(path);
					// Extract frontmatter for folder files
					const folderFile = this.app.vault.getAbstractFileByPath(path);
					if (folderFile instanceof TFile) {
						info.frontmatter!.set(path, this.extractFrontmatter(folderFile));
					}
				}
			}
		}

		// Get semantic matches (semanticMatchCount > 0 = include)
		if (this.contextScopeConfig.semanticMatchCount > 0 && this.plugin.embeddingIndex) {
			try {
				const currentContent = await this.app.vault.cachedRead(file);
				const queryEmbedding = await generateEmbedding(
					currentContent.substring(0, 5000), // Use first part for query
					this.plugin.settings.openaiApiKey,
					this.plugin.settings.embeddingModel
				);

				// Convert percentage to 0-1 range for threshold
				const minSimilarity = this.contextScopeConfig.semanticMinSimilarity / 100;
				const matches = searchSemantic(
					queryEmbedding,
					this.plugin.embeddingIndex,
					seenFiles,
					this.contextScopeConfig.semanticMatchCount,
					minSimilarity
				);

				for (const match of matches) {
					info.semanticNotes.push({
						path: match.notePath,
						score: match.score
					});
					// Extract frontmatter for semantic files
					const semanticFile = this.app.vault.getAbstractFileByPath(match.notePath);
					if (semanticFile instanceof TFile) {
						info.frontmatter!.set(match.notePath, this.extractFrontmatter(semanticFile));
					}
				}
			} catch (error) {
				this.plugin.logger.error('SEMANTIC', 'Failed to get semantic matches for preview', error);
			}
		}

		// Get manually added notes
		if (this.contextScopeConfig.manuallyAddedNotes && this.contextScopeConfig.manuallyAddedNotes.length > 0) {
			for (const path of this.contextScopeConfig.manuallyAddedNotes) {
				if (!seenFiles.has(path)) {
					seenFiles.add(path);
					info.manualNotes.push(path);
					// Extract frontmatter for manual files
					const manualFile = this.app.vault.getAbstractFileByPath(path);
					if (manualFile instanceof TFile) {
						info.frontmatter!.set(path, this.extractFrontmatter(manualFile));
					}
				}
			}
		}

		// Estimate tokens
		const context = await this.plugin.buildContextWithScopeConfig(file, '', this.contextScopeConfig);
		info.totalTokenEstimate = this.plugin.estimateTokens(context);

		return info;
	}

	// Extract alias and description from YAML frontmatter
	extractFrontmatter(file: TFile): NoteFrontmatter {
		const result: NoteFrontmatter = { path: file.path };
		const cache = this.app.metadataCache.getFileCache(file);

		if (cache?.frontmatter) {
			// Extract aliases (can be string or array)
			const aliases = cache.frontmatter.aliases || cache.frontmatter.alias;
			if (aliases) {
				if (Array.isArray(aliases)) {
					result.aliases = aliases.filter((a: unknown) => typeof a === 'string');
				} else if (typeof aliases === 'string') {
					result.aliases = [aliases];
				}
			}

			// Extract description
			const description = cache.frontmatter.description || cache.frontmatter.desc;
			if (typeof description === 'string') {
				result.description = description;
			}
		}

		return result;
	}

	handleActiveFileChange() {
		const currentFile = this.app.workspace.getActiveFile();
		const currentPath = currentFile?.path || null;

		// Check if file actually changed (not just leaf focus)
		if (currentPath && currentPath !== this.lastActiveFilePath) {
			const previousPath = this.lastActiveFilePath;
			this.lastActiveFilePath = currentPath;

			// Only act if we had a previous file and have chat messages
			if (previousPath && this.chatMessages.length > 0) {
				if (this.plugin.settings.clearChatOnNoteSwitch) {
					this.clearChat();
				} else {
					this.showContextIndicator(currentPath, currentFile!.basename);
				}
			}
		}

		this.updateContextSummary();
	}

	showContextIndicator(filePath: string, noteName: string) {
		if (!this.chatContainer) return;

		// Check if the last message is already a context-switch - if so, update it
		const lastMessage = this.chatMessages[this.chatMessages.length - 1];
		if (lastMessage && lastMessage.type === 'context-switch') {
			// Update existing context-switch message
			lastMessage.content = noteName;
			lastMessage.activeFile = filePath;
			lastMessage.timestamp = new Date();

			// Update the DOM element
			const existingEl = this.chatContainer.querySelector(`[data-message-id="${lastMessage.id}"]`);
			if (existingEl) {
				const textSpan = existingEl.querySelector('.ai-chat-context-text');
				if (textSpan) textSpan.setText(noteName);
			}
		} else {
			// Add new context-switch message
			const message: ChatMessage = {
				id: this.generateMessageId(),
				role: 'system',
				type: 'context-switch',
				content: noteName,
				activeFile: filePath,
				timestamp: new Date()
			};
			this.chatMessages.push(message);
			this.renderMessage(message);
		}

		this.scrollChatToBottom();
	}

	// Update context indicators when a file is renamed
	updateContextIndicatorsForRename(oldPath: string, newPath: string, newName: string) {
		for (const message of this.chatMessages) {
			if (message.type === 'context-switch' && message.activeFile === oldPath) {
				message.activeFile = newPath;
				message.content = newName;

				// Update DOM if visible
				if (this.chatContainer) {
					const el = this.chatContainer.querySelector(`[data-message-id="${message.id}"]`);
					if (el) {
						const textSpan = el.querySelector('.ai-chat-context-text');
						if (textSpan) textSpan.setText(newName);
					}
				}
			}
		}
	}

	private getSourcePath(): string {
		return this.app.workspace.getActiveFile()?.path || this.lastActiveFilePath || '';
	}

	generateMessageId(): string {
		return Date.now().toString(36) + Math.random().toString(36).substring(2);
	}

	addMessageToChat(
		role: 'user' | 'assistant',
		content: string,
		metadata?: {
			activeFile?: string;
			proposedEdits?: EditInstruction[];
			editResults?: { success: number; failed: number; failures: Array<{ file: string; error: string }>; accepted?: number; rejected?: number; pending?: number };
			tokenUsage?: TokenUsage;
			model?: string;
			webSources?: WebSource[];
			notesRead?: string[];
		}
	) {
		const message: ChatMessage = {
			id: this.generateMessageId(),
			role,
			content,
			timestamp: new Date(),
			activeFile: metadata?.activeFile,
			proposedEdits: metadata?.proposedEdits,
			editResults: metadata?.editResults,
			tokenUsage: metadata?.tokenUsage,
			model: metadata?.model,
			webSources: metadata?.webSources,
			notesRead: metadata?.notesRead
		};
		this.chatMessages.push(message);
		this.renderMessage(message);
		this.scrollChatToBottom();
	}

	renderMessage(message: ChatMessage) {
		if (!this.chatContainer) return;

		// Remove welcome message if it exists
		const welcome = this.chatContainer.querySelector('.ai-chat-welcome');
		if (welcome) {
			welcome.remove();
		}

		// Handle context-switch messages differently
		if (message.type === 'context-switch') {
			const indicator = this.chatContainer.createDiv({ cls: 'ai-chat-context-indicator' });
			indicator.setAttribute('data-message-id', message.id);
			indicator.createSpan({ cls: 'ai-chat-context-label', text: 'Context: ' });
			indicator.createSpan({ cls: 'ai-chat-context-text', text: message.content });
			return;
		}

		const messageEl = this.chatContainer.createDiv({
			cls: `ai-chat-message ai-chat-message-${message.role}`
		});

		const bubbleEl = messageEl.createDiv({ cls: 'ai-chat-bubble' });

		if (message.role === 'assistant') {
			// Render markdown for AI responses
			MarkdownRenderer.render(
				this.app,
				message.content,
				bubbleEl,
				this.getSourcePath(),
				this
			);

			// Add token usage footer if available and enabled
			if (message.tokenUsage && this.plugin.settings.showTokenUsage) {
				const usageEl = bubbleEl.createDiv({ cls: 'ai-chat-token-usage' });
				usageEl.setText('Tokens: ' + formatTokenUsage(message.tokenUsage, message.model || this.plugin.settings.aiModel, this.plugin.settings.customModelPricing));
			}
		} else {
			// Wrap user text in a span so it's selectable in Electron
			bubbleEl.createSpan({ text: message.content });
		}
	}

	scrollChatToBottom() {
		if (this.chatContainer) {
			this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
		}
	}

	clearChat() {
		this.chatMessages = [];

		if (this.chatContainer) {
			this.chatContainer.empty();
		}

		// Show initial context for current file
		const currentFile = this.app.workspace.getActiveFile();
		if (currentFile) {
			this.showContextIndicator(currentFile.path, currentFile.basename);
		}

		new Notice('Chat history cleared');
	}

	addLoadingIndicator(): HTMLDivElement | null {
		if (!this.chatContainer) return null;

		const loadingEl = this.chatContainer.createDiv({
			cls: 'ai-chat-message ai-chat-message-assistant ai-chat-loading'
		});
		const bubbleEl = loadingEl.createDiv({ cls: 'ai-chat-bubble' });
		bubbleEl.createSpan({ cls: 'ai-chat-loading-dots', text: '...' });

		this.scrollChatToBottom();
		return loadingEl;
	}

	removeLoadingIndicator(loadingEl: HTMLDivElement | null) {
		if (loadingEl) {
			loadingEl.remove();
		}
	}

	createRadioGroup(
		container: HTMLElement,
		name: string,
		options: { value: string; label: string; checked?: boolean }[],
		onChange: (value: string) => void,
		inline = false
	) {
		const group = container.createDiv({ cls: inline ? 'ai-assistant-radio-group-inline' : 'ai-assistant-radio-group' });

		for (const opt of options) {
			const label = group.createEl('label', { cls: 'ai-assistant-radio-label' });
			const input = label.createEl('input', { type: 'radio' });
			input.name = name;
			input.value = opt.value;
			if (opt.checked) input.checked = true;
			input.addEventListener('change', () => {
				if (input.checked) onChange(opt.value);
			});
			label.createSpan({ text: ' ' + opt.label });
		}
	}

	createCheckbox(
		container: HTMLElement,
		label: string,
		checked: boolean,
		onChange: (checked: boolean) => void
	) {
		const labelEl = container.createEl('label', { cls: 'ai-assistant-checkbox-label' });
		const input = labelEl.createEl('input', { type: 'checkbox' });
		input.checked = checked;
		input.addEventListener('change', () => onChange(input.checked));
		labelEl.createSpan({ text: ' ' + label });
	}

	async updateContextSummary() {
		const file = this.app.workspace.getActiveFile();
		if (!file || !this.contextSummary) {
			if (this.contextSummary) {
				this.contextSummary.setText('No active file');
			}
			return;
		}

		try {
			const counts = await this.plugin.getContextNoteCountWithConfig(file, this.contextScopeConfig);

			let summaryText = `${counts.included} note${counts.included !== 1 ? 's' : ''}`;
			if (counts.excluded > 0) {
				summaryText += ` (${counts.excluded} restricted)`;
			}
			this.contextSummary.setText(summaryText);
		} catch (e) {
			this.plugin.logger.error('CONTEXT', 'Error updating context summary', e);
			this.contextSummary.setText('Error');
		}
	}

	setLoading(loading: boolean) {
		this.isLoading = loading;
		if (this.submitButton) {
			this.submitButton.disabled = loading;
			if (loading) {
				this.submitButton.addClass('is-loading');
			} else {
				this.submitButton.removeClass('is-loading');
			}
		}
	}

	async handleSubmit() {
		if (this.isLoading) return;

		if (!this.taskText.trim()) {
			new Notice('Please enter a message');
			return;
		}

		const file = this.app.workspace.getActiveFile(); // May be null

		if (!this.plugin.settings.openaiApiKey) {
			new Notice('Please set your OpenAI API key in settings');
			return;
		}

		const userMessage = this.taskText.trim();

		// Add user message to chat with active file context (may be undefined)
		this.addMessageToChat('user', userMessage, { activeFile: file?.path });

		// Clear input
		if (this.taskTextarea) {
			this.taskTextarea.value = '';
			this.taskText = '';
			this.autoResizeTextarea();
		}

		this.setLoading(true);
		const loadingEl = this.addLoadingIndicator();

		try {
			await this.runAgentLoop(userMessage, file);
		} catch (error) {
			this.plugin.logger.error('AGENT', 'Submit error', error);
			this.removeLoadingIndicator(loadingEl);
			this.removeAgentProgress();
			this.addMessageToChat('assistant', `Error: ${(error as Error).message || 'An error occurred'}`, { activeFile: file?.path });
		} finally {
			this.removeLoadingIndicator(loadingEl);
			this.setLoading(false);
			if (this.stopButton) this.stopButton.style.display = 'none';
			this.agentAbortController = null;
		}
	}

	// Run the unified agent loop
	private async runAgentLoop(userMessage: string, file: TFile | null) {
		// Ensure metadata cache is ready (important on Obsidian startup)
		if (!this.app.workspace.layoutReady) {
			await new Promise<void>(resolve => this.app.workspace.onLayoutReady(() => resolve()));
		}

		// Create abort controller for cancellation
		this.agentAbortController = new AbortController();
		if (this.stopButton) this.stopButton.style.display = '';

		// Create progress container
		this.createAgentProgressContainer();

		// Build current file content
		let currentFileContent: string | undefined;
		let currentFilePath: string | undefined;
		if (file) {
			if (this.plugin.isFileExcluded(file)) {
				new Notice('Active file is excluded (folder or privacy tag) — not sent to AI.');
			} else {
				const raw = await this.app.vault.cachedRead(file);
				currentFileContent = stripPendingEditBlocks(raw, this.plugin.settings.pendingEditTag);
				currentFilePath = file.path;
			}
		}

		// Gather vault stats
		const allFiles = this.app.vault.getMarkdownFiles();
		const allFolders = new Set<string>();
		for (const f of allFiles) {
			if (f.parent) allFolders.add(f.parent.path);
		}
		const allTags = new Set<string>();
		for (const f of allFiles) {
			const cache = this.app.metadataCache.getFileCache(f);
			if (cache?.frontmatter?.tags) {
				const tags = cache.frontmatter.tags;
				if (Array.isArray(tags)) tags.forEach((t: string) => allTags.add(t));
				else if (typeof tags === 'string') allTags.add(tags);
			}
			if (cache?.tags) {
				cache.tags.forEach(t => allTags.add(t.tag.replace(/^#/, '')));
			}
		}

		const input: AgentInput = {
			task: userMessage,
			currentFile: currentFileContent && currentFilePath ? { path: currentFilePath, content: currentFileContent } : undefined,
			vaultStats: {
				totalNotes: allFiles.length,
				totalFolders: allFolders.size,
				totalTags: allTags.size
			},
			chatHistory: this.chatMessages
		};

		const webEnabled = this.isWebSearchConfigured();

		const config: AgentConfig = {
			model: this.plugin.settings.aiModel,
			apiKey: this.plugin.settings.openaiApiKey,
			capabilities: this.capabilities,
			editableScope: this.editableScope,
			maxIterations: this.plugin.settings.agentMaxIterations,
			maxTotalTokens: this.plugin.settings.agentMaxTokens,
			webEnabled,
			webSearchApi: this.plugin.settings.webAgentSearchApi,
			webSearchApiKey: this.plugin.settings.webAgentSearchApiKey,
			webSnippetLimit: this.plugin.settings.webAgentSnippetLimit,
			webFetchLimit: this.plugin.settings.webAgentFetchLimit,
			webTokenBudget: this.plugin.settings.webAgentTokenBudget,
			disabledTools: this.plugin.settings.disabledTools || [],
			whitelistedCommands: this.plugin.settings.whitelistedCommands || [],
			customInfoTools: this.plugin.settings.customInfoTools || [],
			customPrompts: {
				character: this.plugin.settings.customInstructions
			},
			chatHistoryLength: this.plugin.settings.chatHistoryLength,
			debugMode: this.plugin.settings.debugMode
		};

		const callbacks = this.buildAgentCallbacks(file);

		const result = await runAgent(
			input,
			config,
			callbacks,
			this.plugin.logger,
			this.agentAbortController.signal
		);

		// Update progress to completed state
		this.completeAgentProgressFromResult(result);

		// Build response message
		this.buildAgentResponseMessage(result, file?.path);

		// Render copy notes bubble if the agent collected notes
		if (this.pendingCopyPaths.length > 0) {
			this.renderCopyNotesBubble(this.pendingCopyPaths, this.pendingCopyContent);
			this.pendingCopyPaths = [];
			this.pendingCopyContent = '';
		}
	}

	// Build AgentCallbacks bridging to Obsidian APIs
	private buildAgentCallbacks(snapshotActiveFile: TFile | null): AgentCallbacks {
		const plugin = this.plugin;
		const app = this.app;
		const view = this;
		const webEnabled = this.isWebSearchConfigured();
		// Capture active file at agent start to prevent race conditions
		// if user navigates away during execution
		const activeFileAtStart = snapshotActiveFile;

		// Helper: get all supported files (.md + .canvas)
		function getSupportedFiles(): TFile[] {
			return app.vault.getFiles().filter(f => f.extension === 'md' || f.extension === 'canvas');
		}

		// Helper: find a note by exact path, partial path, filename, or basename
		// Returns null if not found. Throws with a descriptive message if ambiguous.
		// Use safeFindNote() for callbacks that need { error } returns.
		function findNoteByAnyName(pathOrName: string): TFile | null {
			const files = getSupportedFiles();

			// 1. Exact path match (always unambiguous)
			const exactMatch = files.find(f => f.path === pathOrName);
			if (exactMatch) return exactMatch;

			// 2. Suffix match (path ends with /pathOrName)
			const suffixMatches = files.filter(f => f.path.endsWith('/' + pathOrName));
			if (suffixMatches.length === 1) return suffixMatches[0];
			if (suffixMatches.length > 1) {
				throw new Error(`Ambiguous note name "${pathOrName}" matches ${suffixMatches.length} files: ${suffixMatches.slice(0, 5).map(f => f.path).join(', ')}. Use the full path.`);
			}

			// 3. Filename match (e.g., "Note.md")
			const nameMatches = files.filter(f => f.name === pathOrName);
			if (nameMatches.length === 1) return nameMatches[0];
			if (nameMatches.length > 1) {
				throw new Error(`Ambiguous note name "${pathOrName}" matches ${nameMatches.length} files: ${nameMatches.slice(0, 5).map(f => f.path).join(', ')}. Use the full path.`);
			}

			// 4. Basename match (without extension)
			const baseName = pathOrName.replace(/\.(md|canvas)$/, '');
			const baseMatches = files.filter(f => f.basename === baseName);
			if (baseMatches.length === 1) return baseMatches[0];
			if (baseMatches.length > 1) {
				throw new Error(`Ambiguous note name "${pathOrName}" matches ${baseMatches.length} files: ${baseMatches.slice(0, 5).map(f => f.path).join(', ')}. Use the full path.`);
			}

			return null;
		}

		// Safe wrapper: returns { file, error } so callers can return error messages
		function safeFindNote(pathOrName: string): { file: TFile | null; error?: string } {
			try {
				const file = findNoteByAnyName(pathOrName);
				return { file };
			} catch (e) {
				return { file: null, error: (e as Error).message };
			}
		}

		return {
			async readNote(path: string) {
				const { file: matchingFile, error } = safeFindNote(path);
				if (error) return { content: error, path, lineCount: 0 };
				if (!matchingFile) return null;
				if (plugin.isPathExcluded(matchingFile.path)) {
					return { content: '', path: matchingFile.path, lineCount: 0, excluded: true };
				}
				const content = await app.vault.cachedRead(matchingFile);
				const cleanContent = stripPendingEditBlocks(content, plugin.settings.pendingEditTag);
				const numbered = addLineNumbers(cleanContent);
				return { content: numbered, path: matchingFile.path, lineCount: cleanContent.split('\n').length };
			},

			async searchKeyword(query: string, limit: number): Promise<KeywordResult[]> {
				const files = getSupportedFiles();
				const results: KeywordResult[] = [];
				const queryLower = query.toLowerCase();

				for (const file of files) {
					if (plugin.isPathExcluded(file.path)) continue;
					if (results.length >= limit) break;

					if (file.basename.toLowerCase().includes(queryLower)) {
						results.push({ path: file.path, name: file.basename, matchType: 'title', matchContext: file.basename });
						continue;
					}

					const cache = app.metadataCache.getFileCache(file);
					if (cache?.headings) {
						const headingMatch = cache.headings.find(h => h.heading.toLowerCase().includes(queryLower));
						if (headingMatch) {
							const headingLine = headingMatch.position.start.line + 1;
							results.push({ path: file.path, name: file.basename, matchType: 'heading', matchContext: headingMatch.heading, lineNumber: headingLine });
							continue;
						}
					}

					const content = await app.vault.cachedRead(file);
					const contentLower = content.toLowerCase();
					const idx = contentLower.indexOf(queryLower);
					if (idx !== -1) {
						const lineNumber = content.substring(0, idx).split('\n').length;
						const start = Math.max(0, idx - 50);
						const end = Math.min(content.length, idx + query.length + 50);
						results.push({ path: file.path, name: file.basename, matchType: 'content', matchContext: content.substring(start, end).trim(), lineNumber });
					}
				}
				return results;
			},

			async searchSemantic(query: string, topK: number): Promise<SemanticSearchResult[]> {
				if (!plugin.embeddingIndex) return [];
				try {
					const queryEmbedding = await generateEmbedding(
						query.substring(0, 8000),
						plugin.settings.openaiApiKey,
						plugin.settings.embeddingModel
					);
					// Build exclude paths from excluded folders and privacy tags
					const excludePaths = new Set<string>();
					for (const chunk of plugin.embeddingIndex.chunks) {
						if (plugin.isPathExcluded(chunk.notePath)) {
							excludePaths.add(chunk.notePath);
						}
					}
					return searchSemantic(queryEmbedding, plugin.embeddingIndex, excludePaths, topK, 0.3);
				} catch {
					return [];
				}
			},

			async listNotes(folder?: string, limit?: number, previewLength?: number): Promise<NotePreview[]> {
				const files = getSupportedFiles();
				const maxResults = limit || 200;
				const results: NotePreview[] = [];
				const pLen = previewLength || 0;

				for (const file of files) {
					if (results.length >= maxResults) break;
					if (plugin.isPathExcluded(file.path)) continue;
					if (folder !== undefined) {
						if (folder === '' || folder === '/') {
							if (file.path.includes('/')) continue;
						} else {
							if (!file.path.startsWith(folder.endsWith('/') ? folder : folder + '/')) continue;
						}
					}

					const cache = app.metadataCache.getFileCache(file);
					let preview = '';
					if (pLen > 0) {
						const content = await app.vault.cachedRead(file);
						preview = content.substring(0, pLen).trim();
					}

					results.push({
						path: file.path,
						name: file.basename,
						preview,
						tags: cache?.frontmatter?.tags ? (Array.isArray(cache.frontmatter.tags) ? cache.frontmatter.tags : [cache.frontmatter.tags]) : undefined
					});
				}
				return results;
			},

			async getLinks(path: string, direction: string, depth?: number): Promise<LinkInfo[]> {
				const file = app.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) return [];

				const results: LinkInfo[] = [];
				const maxDepth = depth || 1;
				if (direction === 'outgoing' || direction === 'both') {
					const cache = app.metadataCache.getFileCache(file);
					for (const link of cache?.links ?? []) {
						const linkedFile = app.metadataCache.getFirstLinkpathDest(link.link, file.path);
						if (linkedFile && linkedFile instanceof TFile) {
							if (plugin.isPathExcluded(linkedFile.path)) continue;
							results.push({ path: linkedFile.path, name: linkedFile.basename, direction: 'outgoing', depth: 1 });
						}
					}
				}

				if (direction === 'incoming' || direction === 'both') {
					const backlinks = plugin.getBacklinkPaths(file);
					for (const blPath of backlinks) {
						if (plugin.isPathExcluded(blPath)) continue;
						results.push({ path: blPath, name: blPath.split('/').pop()?.replace('.md', '') || blPath, direction: 'incoming', depth: 1 });
					}
				}

				if (maxDepth > 1) {
					const deepLinks = plugin.getLinkedFilesBFS(file, maxDepth);
					const existing = new Set(results.map(r => r.path));
					for (const p of deepLinks) {
						if (!existing.has(p) && !plugin.isPathExcluded(p)) {
							results.push({ path: p, name: p.split('/').pop()?.replace('.md', '') || p, direction: 'both', depth: maxDepth });
						}
					}
				}

				return results;
			},

			async exploreStructure(action: string, args: Record<string, unknown>): Promise<string> {
				if (action === 'list_folder') {
					let folderPath = (args.folder as string) || '';
					if (folderPath === '/') folderPath = '';
					// Block browsing excluded folders entirely
					if (folderPath && isFolderExcluded(folderPath, plugin.settings.excludedFolders)) {
						return `Folder "${folderPath}" is excluded and cannot be browsed.`;
					}
					const abstractFolder = folderPath === ''
						? app.vault.getRoot()
						: app.vault.getAbstractFileByPath(folderPath);
					if (abstractFolder && abstractFolder instanceof TFolder) {
						const recursive = !!args.recursive;

						const noteNames = args.note_names !== false;

						if (recursive) {
							const lines: string[] = [];
							const MAX_ENTRIES = 200;

							const walk = (folder: TFolder, indent: string) => {
								const children = folder.children
									.filter(c => {
										if (c instanceof TFile) return !plugin.isPathExcluded(c.path);
										return !isFolderExcluded(c.path, plugin.settings.excludedFolders);
									})
									.sort((a, b) => {
										const aIsFolder = a instanceof TFolder;
										const bIsFolder = b instanceof TFolder;
										if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
										return a.name.localeCompare(b.name);
									});

								for (const c of children) {
									if (lines.length >= MAX_ENTRIES) return;
									if (c instanceof TFolder) {
										if (noteNames) {
											lines.push(`${indent}${c.name}/ (folder)`);
										} else {
											const directNotes = c.children.filter(ch => ch instanceof TFile && !plugin.isPathExcluded(ch.path)).length;
											lines.push(`${indent}${c.name}/ (${directNotes} notes)`);
										}
										walk(c, indent + '  ');
									} else if (noteNames) {
										lines.push(`${indent}${c.name} (note)`);
									}
								}
							};

							if (!noteNames) {
								const rootNotes = abstractFolder.children.filter(c => c instanceof TFile && !plugin.isPathExcluded(c.path)).length;
								if (rootNotes > 0) lines.push(`(${rootNotes} notes in root)`);
							}
							walk(abstractFolder, '');
							let result = lines.join('\n') || 'Empty folder';
							if (lines.length >= MAX_ENTRIES) {
								result += `\n... truncated at ${MAX_ENTRIES} entries (use non-recursive listing for specific folders)`;
							}
							return result;
						} else {
							const children = abstractFolder.children
								.filter(c => {
									if (c instanceof TFile) return !plugin.isPathExcluded(c.path);
									// Hide excluded subfolders
									return !isFolderExcluded(c.path, plugin.settings.excludedFolders);
								});
							if (noteNames) {
								return children
									.map(c => c instanceof TFile ? `${c.name} (note)` : `${c.name}/ (folder)`)
									.sort()
									.join('\n') || 'Empty folder';
							} else {
								const folders = children.filter(c => c instanceof TFolder);
								const noteCount = children.filter(c => c instanceof TFile).length;
								const folderLines = folders
									.map(c => `${c.name}/ (folder)`)
									.sort();
								if (noteCount > 0) folderLines.push(`(${noteCount} notes)`);
								return folderLines.join('\n') || 'Empty folder';
							}
						}
					}
					return `Folder not found: ${folderPath}`;
				} else if (action === 'find_by_tag') {
					const tag = (args.tag as string || '').replace(/^#/, '');
					const matches: string[] = [];
					for (const f of app.vault.getMarkdownFiles()) {
						if (plugin.isPathExcluded(f.path)) continue;
						const cache = app.metadataCache.getFileCache(f);
						const fmTags = cache?.frontmatter?.tags;
						const inlineTags = cache?.tags?.map(t => t.tag.replace(/^#/, ''));
						const allFileTags = [
							...(Array.isArray(fmTags) ? fmTags : fmTags ? [fmTags] : []),
							...(inlineTags || [])
						];
						if (allFileTags.some(t => t === tag || t.startsWith(tag + '/'))) {
							matches.push(f.path);
						}
					}
					return matches.length > 0 ? matches.join('\n') : `No notes found with tag #${tag}`;
				}
				return `Unknown action: ${action}`;
			},

			async listTags(): Promise<{ tag: string; count: number }[]> {
				const tagCounts = new Map<string, number>();
				for (const f of app.vault.getMarkdownFiles()) {
					if (plugin.isPathExcluded(f.path)) continue;
					const cache = app.metadataCache.getFileCache(f);
					const tags: string[] = [];
					if (cache?.frontmatter?.tags) {
						const fm = cache.frontmatter.tags;
						if (Array.isArray(fm)) tags.push(...fm);
						else if (typeof fm === 'string') tags.push(fm);
					}
					if (cache?.tags) {
						cache.tags.forEach(t => tags.push(t.tag.replace(/^#/, '')));
					}
					for (const tag of tags) {
						tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
					}
				}
				return [...tagCounts.entries()]
					.map(([tag, count]) => ({ tag, count }))
					.sort((a, b) => b.count - a.count);
			},

			async getAllNotes(includeMetadata?: boolean) {
				return getSupportedFiles()
					.filter(f => !plugin.isPathExcluded(f.path))
					.map(f => {
						const result: { path: string; aliases?: string[]; description?: string } = { path: f.path };
						if (includeMetadata) {
							const cache = app.metadataCache.getFileCache(f);
							if (cache?.frontmatter) {
								const aliases = cache.frontmatter.aliases || cache.frontmatter.alias;
								if (aliases) result.aliases = Array.isArray(aliases) ? aliases : [aliases];
								const desc = cache.frontmatter.description || cache.frontmatter.desc;
								if (typeof desc === 'string') result.description = desc;
							}
						}
						return result;
					});
			},

			async getManualContext(summaryOnly?: boolean): Promise<string> {
				const scopeConfig = view.contextScopeConfig;
				const hasConfig = scopeConfig.linkDepth > 0
					|| scopeConfig.maxFolderNotes > 0
					|| scopeConfig.semanticMatchCount > 0
					|| (scopeConfig.manuallyAddedNotes && scopeConfig.manuallyAddedNotes.length > 0);

				if (!hasConfig) {
					return 'Manual context is empty. The user has not configured any context notes (all sliders are at 0 and no notes were manually added). You can still use search_vault or read_note to find relevant notes.';
				}

				const activeFile = app.workspace.getActiveFile();
				if (!activeFile) {
					return 'No active file is open. Manual context requires an active note as the starting point for linked/folder notes. Ask the user to open a note first.';
				}

				const configParts: string[] = [];
				if (scopeConfig.linkDepth > 0) configParts.push(`link depth: ${scopeConfig.linkDepth}`);
				if (scopeConfig.maxLinkedNotes > 0) configParts.push(`max linked: ${scopeConfig.maxLinkedNotes}`);
				if (scopeConfig.maxFolderNotes > 0) configParts.push(`folder notes: ${scopeConfig.maxFolderNotes}`);
				if (scopeConfig.semanticMatchCount > 0) configParts.push(`semantic matches: ${scopeConfig.semanticMatchCount}`);
				if (scopeConfig.manuallyAddedNotes && scopeConfig.manuallyAddedNotes.length > 0) configParts.push(`manually added: ${scopeConfig.manuallyAddedNotes.length}`);

				if (summaryOnly) {
					const summaryLines: string[] = [];
					const seenFiles = new Set<string>();
					seenFiles.add(activeFile.path);

					const getPreview = async (file: TFile): Promise<string> => {
						const content = await app.vault.cachedRead(file);
						return content.split('\n').filter((l: string) => l.trim()).slice(0, 2).join(' | ');
					};

					if (!plugin.isFileExcluded(activeFile)) {
						const preview = await getPreview(activeFile);
						summaryLines.push(`[current] ${activeFile.path} — ${preview}`);
					}

					if (scopeConfig.linkDepth > 0 && scopeConfig.maxLinkedNotes > 0) {
						const linkedFiles = plugin.getLinkedFilesBFS(activeFile, scopeConfig.linkDepth);
						const limitedLinked = [...linkedFiles].slice(0, scopeConfig.maxLinkedNotes);
						for (const linkedPath of limitedLinked) {
							if (!seenFiles.has(linkedPath)) {
								seenFiles.add(linkedPath);
								const linkedFile = app.vault.getAbstractFileByPath(linkedPath);
								if (linkedFile instanceof TFile) {
									const preview = await getPreview(linkedFile);
									summaryLines.push(`[linked] ${linkedFile.path} — ${preview}`);
								}
							}
						}
					}

					if (scopeConfig.maxFolderNotes > 0) {
						const folderFiles = plugin.getSameFolderFiles(activeFile);
						const limitedFolder = [...folderFiles].slice(0, scopeConfig.maxFolderNotes);
						for (const folderPath of limitedFolder) {
							if (!seenFiles.has(folderPath)) {
								seenFiles.add(folderPath);
								const folderFile = app.vault.getAbstractFileByPath(folderPath);
								if (folderFile instanceof TFile) {
									const preview = await getPreview(folderFile);
									summaryLines.push(`[folder] ${folderFile.path} — ${preview}`);
								}
							}
						}
					}

					if (scopeConfig.manuallyAddedNotes && scopeConfig.manuallyAddedNotes.length > 0) {
						for (const manualPath of scopeConfig.manuallyAddedNotes) {
							if (!seenFiles.has(manualPath)) {
								seenFiles.add(manualPath);
								const manualFile = app.vault.getAbstractFileByPath(manualPath);
								if (manualFile instanceof TFile && !plugin.isFileExcluded(manualFile)) {
									const preview = await getPreview(manualFile);
									summaryLines.push(`[manual] ${manualFile.path} — ${preview}`);
								}
							}
						}
					}

					if (summaryLines.length === 0) {
						return 'Manual context is configured but no notes were found. The linked/folder notes may be empty or excluded.';
					}

					const header = `=== Manual Context Summary (${configParts.join(', ')}, ${summaryLines.length} notes) ===\n`;
					return header + summaryLines.join('\n') + '\n\nUse get_manual_context without summary_only to get full content, or read_note to read specific notes.';
				}

				const context = await plugin.buildContextWithScopeConfig(activeFile, '', scopeConfig);
				if (!context || context.trim().length === 0) {
					return 'Manual context is configured but returned no content. The linked/folder/semantic notes may be empty.';
				}

				const header = `=== Manual Context (${configParts.join(', ')}) ===\n`;
				return header + context;
			},

			webSearch: webEnabled ? async (query: string, limit: number) => {
				const apiKey = plugin.settings.webAgentSearchApi === 'openai'
					? plugin.settings.openaiApiKey
					: plugin.settings.webAgentSearchApiKey;
				return webSearch(query, plugin.settings.webAgentSearchApi, apiKey, limit);
			} : undefined,

			fetchPage: webEnabled ? async (url: string, maxTokens: number) => {
				return fetchPage(url, maxTokens);
			} : undefined,

			async proposeEdit(edit: EditInstruction) {
				const validated = await plugin.validateEdits([edit]);
				if (validated[0]?.error) {
					return { success: false, error: validated[0].error };
				}

				if (activeFileAtStart) {
					plugin.filterEditsByRulesWithConfig(
						validated,
						activeFileAtStart,
						view.editableScope,
						view.capabilities,
						view.contextScopeConfig
					);
				}

				if (validated[0]?.error) {
					return { success: false, error: validated[0].error };
				}

				if (edit.position === 'open') {
					const navFile = validated[0]?.resolvedFile;
					if (navFile) {
						await app.workspace.getLeaf('tab').openFile(navFile);
						return { success: true };
					}
					return { success: false, error: 'File not found' };
				}

				const result = await plugin.insertEditBlocks(validated);
				return { success: result.success > 0, error: result.failed > 0 ? 'Some edits failed' : undefined };
			},

			async createNote(path: string, content: string) {
				if (!view.capabilities.canCreate) {
					return { success: false, error: 'Creating new files is not allowed (capability disabled)' };
				}
				if (plugin.isPathExcluded(path)) {
					return { success: false, error: 'Cannot create notes in an excluded location' };
				}
				try {
					const folderPath = path.substring(0, path.lastIndexOf('/'));
					if (folderPath) {
						const folder = app.vault.getAbstractFileByPath(folderPath);
						if (!folder) {
							await app.vault.createFolder(folderPath);
						}
					}
					const validated: ValidatedEdit[] = [{
						instruction: { file: path, position: 'create', content },
						resolvedFile: null,
						currentContent: '',
						newContent: content,
						error: null,
						isNewFile: true
					}];
					const result = await plugin.insertEditBlocks(validated);
					return { success: result.success > 0, error: result.failed > 0 ? 'Failed to create note' : undefined };
				} catch (e) {
					return { success: false, error: (e as Error).message };
				}
			},

			async openNote(path: string) {
				const { file: matchingFile, error } = safeFindNote(path);
				if (error) return { success: false, error };
				if (matchingFile) {
					await app.workspace.getLeaf('tab').openFile(matchingFile);
					return { success: true };
				}
				return { success: false, error: `Note not found: ${path}` };
			},

			async moveNote(from: string, to: string) {
				if (plugin.isPathExcluded(from)) {
					return { success: false, error: 'Note is excluded (folder or privacy tag)' };
				}
				const f = app.vault.getAbstractFileByPath(from);
				if (!(f instanceof TFile)) {
					return { success: false, error: `Note not found: ${from}` };
				}
				try {
					const targetFolder = to.substring(0, to.lastIndexOf('/'));
					if (targetFolder && !app.vault.getAbstractFileByPath(targetFolder)) {
						await app.vault.createFolder(targetFolder);
					}
					const originalPath = f.path;
					await app.fileManager.renameFile(f, to);
					// Show review bubble (f reference updates in-place after rename)
					view.renderPendingMoveBubble(originalPath, to, f);
					return { success: true, newPath: to };
				} catch (e) {
					return { success: false, error: (e as Error).message };
				}
			},

			async updateProperties(path: string, props: Record<string, unknown>) {
				if (plugin.isPathExcluded(path)) {
					return { success: false, error: 'Note is excluded (folder or privacy tag)' };
				}
				const f = app.vault.getAbstractFileByPath(path);
				if (!(f instanceof TFile)) {
					return { success: false, error: `Note not found: ${path}` };
				}
				try {
					// Snapshot previous values before applying changes
					const cache = app.metadataCache.getFileCache(f);
					const previousValues: Record<string, unknown> = {};
					for (const key of Object.keys(props)) {
						previousValues[key] = cache?.frontmatter?.[key] ?? null;
					}

					await app.fileManager.processFrontMatter(f, (fm) => {
						for (const [key, value] of Object.entries(props)) {
							if (value === null) delete fm[key];
							else fm[key] = value;
						}
					});
					// Show review bubble
					view.renderPendingPropertiesBubble(f, props, previousValues);
					return { success: true };
				} catch (e) {
					return { success: false, error: (e as Error).message };
				}
			},

			async addTags(path: string, tags: string[]) {
				if (plugin.isPathExcluded(path)) {
					return { success: false, error: 'Note is excluded (folder or privacy tag)' };
				}
				const f = app.vault.getAbstractFileByPath(path);
				if (!(f instanceof TFile)) {
					return { success: false, error: `Note not found: ${path}` };
				}
				try {
					// Snapshot previous tags before applying changes
					const cache = app.metadataCache.getFileCache(f);
					const previousTags: string[] = cache?.frontmatter?.tags
						? (Array.isArray(cache.frontmatter.tags) ? [...cache.frontmatter.tags] : [cache.frontmatter.tags])
						: [];

					await app.fileManager.processFrontMatter(f, (fm) => {
						const existing = fm.tags || [];
						const currentTags = Array.isArray(existing) ? existing : [existing];
						const normalizedNew = tags.map(t => t.replace(/^#/, ''));
						fm.tags = [...new Set([...currentTags, ...normalizedNew])];
					});
					// Show review bubble
					const normalizedNew = tags.map(t => t.replace(/^#/, ''));
					view.renderPendingTagsBubble(f, normalizedNew, previousTags);
					return { success: true };
				} catch (e) {
					return { success: false, error: (e as Error).message };
				}
			},

			async linkNotes(source: string, target: string, context?: string) {
				if (plugin.isPathExcluded(source)) {
					return { success: false, error: 'Note is excluded (folder or privacy tag)' };
				}
				const sourceFile = app.vault.getAbstractFileByPath(source);
				if (!(sourceFile instanceof TFile)) {
					return { success: false, error: `Source note not found: ${source}` };
				}
				try {
					const baseName = target.split('/').pop() || target;
					const linkTarget = baseName.replace(/\.md$/, '');
					const wikilink = `[[${linkTarget}]]`;

					// Determine position for the edit
					let position = 'end';
					if (context) {
						const content = await app.vault.read(sourceFile);
						const lines = content.split('\n');
						const headingIdx = lines.findIndex(l => l.trim() === context.trim());
						if (headingIdx !== -1) {
							position = `insert:${headingIdx + 2}`;
						}
					}

					// Route through edit system for inline accept/reject widget
					const edit: EditInstruction = { file: source, position, content: wikilink };
					const validated = await plugin.validateEdits([edit]);
					if (validated[0]?.error) {
						return { success: false, error: validated[0].error };
					}
					const activeFile = app.workspace.getActiveFile();
					if (activeFile) {
						plugin.filterEditsByRulesWithConfig(
							validated, activeFile, view.editableScope,
							view.capabilities, view.contextScopeConfig
						);
					}
					if (validated[0]?.error) {
						return { success: false, error: validated[0].error };
					}
					const result = await plugin.insertEditBlocks(validated);
					return { success: result.success > 0, error: result.failed > 0 ? 'Some edits failed' : undefined };
				} catch (e) {
					return { success: false, error: (e as Error).message };
				}
			},

			async copyNotes(paths: string[]) {
				const contents: string[] = [];
				for (const p of paths) {
					if (plugin.isPathExcluded(p)) continue;
					const f = app.vault.getAbstractFileByPath(p);
					if (f instanceof TFile) {
						const content = await app.vault.cachedRead(f);
						const noteName = f.basename;
						contents.push(`--- New Note: "${noteName}" ---\n${content}`);
					}
				}
				const combined = contents.join('\n\n');
				// Store for the copy notes bubble (rendered after agent response)
				view.pendingCopyContent = combined;
				view.pendingCopyPaths = paths.filter(p => app.vault.getAbstractFileByPath(p) instanceof TFile);
				return { content: combined, noteCount: contents.length };
			},

			// Advanced vault reading callbacks (always provided; filtering by disabledTools in agent.ts)
			async getProperties(path: string) {
				const { file, error } = safeFindNote(path);
				if (error) return null; // vaultTools.ts handles null with "not found" message
				if (!file) return null;
				if (plugin.isPathExcluded(file.path)) return null;
				const cache = app.metadataCache.getFileCache(file);
				const fm = cache?.frontmatter;
				if (!fm) return {};
				const props: Record<string, unknown> = {};
				for (const [k, v] of Object.entries(fm)) {
					if (k !== 'position') props[k] = v;
				}
				return props;
			},

			async getFileInfo(path: string) {
				const { file, error } = safeFindNote(path);
				if (error) return null; // vaultTools.ts handles null with "not found" message
				if (!file) return null;
				if (plugin.isPathExcluded(file.path)) return null;
				return {
					created: file.stat.ctime,
					modified: file.stat.mtime,
					size: file.stat.size
				};
			},

			async findDeadLinks(path?: string) {
				const unresolvedLinks = (app.metadataCache as any).unresolvedLinks as Record<string, Record<string, number>> | undefined;
				if (!unresolvedLinks) return [];
				const results: Array<{ source: string; deadLink: string }> = [];
				for (const [sourcePath, links] of Object.entries(unresolvedLinks)) {
					if (plugin.isPathExcluded(sourcePath)) continue;
					if (path) {
						const { file } = safeFindNote(path);
						if (!file || file.path !== sourcePath) continue;
					}
					for (const deadLink of Object.keys(links)) {
						results.push({ source: sourcePath, deadLink });
					}
				}
				return results;
			},

			async queryNotes(filter: Record<string, unknown>, options: any) {
				const files = getSupportedFiles();
				let results: Array<{ path: string; matchingProperties?: Record<string, unknown>; modified?: number; created?: number }> = [];

				for (const file of files) {
					if (plugin.isPathExcluded(file.path)) continue;

					if (options.modified_after) {
						const afterMs = new Date(options.modified_after).getTime();
						if (file.stat.mtime < afterMs) continue;
					}
					if (options.modified_before) {
						const beforeMs = new Date(options.modified_before).getTime();
						if (file.stat.mtime > beforeMs) continue;
					}

					const cache = app.metadataCache.getFileCache(file);
					const fm = cache?.frontmatter || {};

					if (options.has_property && !(options.has_property in fm)) continue;

					const filterKeys = Object.keys(filter);
					if (filterKeys.length > 0) {
						let allMatch = true;
						for (const key of filterKeys) {
							if (fm[key] === undefined || String(fm[key]) !== String(filter[key])) {
								allMatch = false;
								break;
							}
						}
						if (!allMatch) continue;
					}

					const matchingProps: Record<string, unknown> = {};
					for (const key of filterKeys) {
						if (key in fm) matchingProps[key] = fm[key];
					}
					if (options.has_property && options.has_property in fm) {
						matchingProps[options.has_property] = fm[options.has_property];
					}

					results.push({
						path: file.path,
						matchingProperties: Object.keys(matchingProps).length > 0 ? matchingProps : undefined,
						modified: file.stat.mtime,
						created: file.stat.ctime
					});
				}

				if (options.sort_by === 'modified') {
					results.sort((a, b) => (b.modified || 0) - (a.modified || 0));
				} else if (options.sort_by === 'created') {
					results.sort((a, b) => (b.created || 0) - (a.created || 0));
				} else {
					results.sort((a, b) => a.path.localeCompare(b.path));
				}

				results = results.slice(0, options.limit || 20);
				return results;
			},

			// Destructive action callbacks (always provided; filtering by disabledTools in agent.ts)
			async deleteNote(path: string) {
				try {
					const file = findNoteByAnyName(path);
					if (!file) return { success: false, error: `Note not found: "${path}"` };
					if (plugin.isPathExcluded(file.path)) {
						return { success: false, error: 'Note is excluded (folder or privacy tag)' };
					}
					// Don't delete immediately — show confirmation bubble
					view.renderPendingDeletionBubble(file);
					// Return success but signal that deletion is pending user confirmation
					// The file still exists until the user clicks "Delete"
					return { success: true, pending: true };
				} catch (e) {
					return { success: false, error: (e as Error).message };
				}
			},

			async executeCommand(commandId: string) {
				try {
					const whitelist = plugin.settings.whitelistedCommands;
					const allowed = whitelist.find((c: WhitelistedCommand) => c.id === commandId);
					if (!allowed) {
						return { success: false, error: `Command "${commandId}" is not whitelisted` };
					}
					await (app as any).commands.executeCommandById(commandId);
					return { success: true };
				} catch (e) {
					return { success: false, error: (e as Error).message };
				}
			},

			async listCommands() {
				const commands = (app as any).commands.listCommands() as Array<{ id: string; name: string }>;
				return commands.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }));
			},

			async getVaultStats(): Promise<string> {
				const files = getSupportedFiles();
				const folders = new Set<string>();
				const tagCounts = new Map<string, number>();
				let totalSize = 0;
				let sampledLength = 0;
				let sampledCount = 0;
				const sampleLimit = 200;

				for (const f of files) {
					if (f.parent) folders.add(f.parent.path);
					totalSize += f.stat.size;

					// Tag extraction from metadata cache
					const cache = app.metadataCache.getFileCache(f);
					if (cache?.frontmatter?.tags) {
						const tags = cache.frontmatter.tags;
						const tagList = Array.isArray(tags) ? tags : [tags];
						for (const t of tagList) {
							const clean = String(t).replace(/^#/, '');
							tagCounts.set(clean, (tagCounts.get(clean) || 0) + 1);
						}
					}
					if (cache?.tags) {
						for (const t of cache.tags) {
							const clean = t.tag.replace(/^#/, '');
							tagCounts.set(clean, (tagCounts.get(clean) || 0) + 1);
						}
					}

					// Sample for average length
					if (sampledCount < sampleLimit) {
						sampledLength += f.stat.size;
						sampledCount++;
					}
				}

				// Top 15 tags
				const topTags = [...tagCounts.entries()]
					.sort((a, b) => b[1] - a[1])
					.slice(0, 15)
					.map(([tag, count]) => `${tag} (${count})`)
					.join(', ');

				// 10 most recently modified
				const recent = [...files]
					.sort((a, b) => b.stat.mtime - a.stat.mtime)
					.slice(0, 10)
					.map(f => `- ${f.path} (${new Date(f.stat.mtime).toISOString().split('T')[0]})`)
					.join('\n');

				const avgLength = sampledCount > 0 ? Math.round(sampledLength / sampledCount / 1024 * 10) / 10 : 0;
				const totalMB = Math.round(totalSize / 1024 / 1024 * 100) / 100;

				return `VAULT OVERVIEW
Total notes: ${files.length}
Total folders: ${folders.size}
Total tags: ${tagCounts.size}
Total size: ${totalMB} MB
Avg note size: ${avgLength} KB (sampled ${sampledCount} notes)

TOP TAGS: ${topTags || 'none'}

RECENTLY MODIFIED:
${recent || 'none'}`;
			},

			async searchAndReplace(search: string, replace: string, paths?: string[], useRegex?: boolean) {
				const MAX_REPLACEMENTS = 50;
				let matchCount = 0;
				const filesMatched = new Set<string>();
				const errors: string[] = [];

				// Determine target files
				let targetFiles: TFile[];
				if (paths && paths.length > 0) {
					targetFiles = [];
					for (const p of paths) {
						const { file: f, error } = safeFindNote(p);
						if (f) targetFiles.push(f);
						else errors.push(error || `Note not found: "${p}"`);
					}
				} else {
					// Use snapshotted active file for scope determination
					if (!activeFileAtStart) {
						return { matchCount: 0, fileCount: 0, errors: ['No active file — cannot determine editable scope'] };
					}
					const editableSet = plugin.getEditableFilesWithConfig(activeFileAtStart, view.editableScope, view.contextScopeConfig);
					targetFiles = app.vault.getMarkdownFiles().filter(f => editableSet.has(f.path));
				}

				// Build regex
				let pattern: RegExp;
				try {
					pattern = useRegex ? new RegExp(search, 'g') : new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
				} catch (e) {
					return { matchCount: 0, fileCount: 0, errors: [`Invalid regex: ${(e as Error).message}`] };
				}

				for (const file of targetFiles) {
					if (matchCount >= MAX_REPLACEMENTS) break;
					if (plugin.isPathExcluded(file.path)) continue;

					try {
						const raw = await app.vault.cachedRead(file);
						const content = stripPendingEditBlocks(raw, plugin.settings.pendingEditTag);
						const lines = content.split('\n');

						for (let i = 0; i < lines.length; i++) {
							if (matchCount >= MAX_REPLACEMENTS) break;
							pattern.lastIndex = 0;
							if (pattern.test(lines[i])) {
								pattern.lastIndex = 0;
								const newLine = lines[i].replace(pattern, replace);
								const lineNum = i + 1;
								const edit: EditInstruction = {
									file: file.path,
									position: `replace:${lineNum}`,
									content: newLine
								};
								// Inline proposeEdit logic: validate, filter, insert
								const validated = await plugin.validateEdits([edit]);
								if (validated[0]?.error) {
									errors.push(`${file.path}:${lineNum}: ${validated[0].error}`);
									continue;
								}
								if (activeFileAtStart) {
									plugin.filterEditsByRulesWithConfig(validated, activeFileAtStart, view.editableScope, view.capabilities, view.contextScopeConfig);
								}
								if (validated[0]?.error) {
									errors.push(`${file.path}:${lineNum}: ${validated[0].error}`);
									continue;
								}
								const result = await plugin.insertEditBlocks(validated);
								if (result.success > 0) {
									matchCount++;
									filesMatched.add(file.path);
								}
							}
						}
					} catch (e) {
						errors.push(`Error reading ${file.path}: ${(e as Error).message}`);
					}
				}

				return { matchCount, fileCount: filesMatched.size, errors };
			},

			async resolveCustomInfoTool(toolName: string): Promise<string | null> {
				const tool = (plugin.settings.customInfoTools || []).find(t => t.toolName === toolName && t.enabled);
				if (!tool) return null;
				if (tool.contentType === 'inline') {
					return tool.inlineContent || '(empty)';
				}
				if (tool.contentType === 'note' && tool.notePath) {
					const file = app.vault.getAbstractFileByPath(tool.notePath);
					if (file && file instanceof TFile) {
						return await app.vault.cachedRead(file);
					}
					return `Error: Note "${tool.notePath}" not found in vault.`;
				}
				return null;
			},

			async getChatHistory(offset: number, count: number) {
				const allMessages = view.chatMessages;
				// Exclude the current (last) message — it's the active request
				const historyPool = allMessages.slice(0, -1);
				const totalAvailable = historyPool.length;
				// Return messages newest-first, paged by offset/count
				const start = Math.max(0, historyPool.length - offset - count);
				const end = Math.max(0, historyPool.length - offset);
				const slice = historyPool.slice(start, end).reverse();
				return { messages: slice, totalAvailable };
			},

			async getNoteStats(paths: string[]) {
				const results: any[] = [];
				for (const p of paths) {
					const { file, error } = safeFindNote(p);
					if (!file) {
						results.push({ path: p, error: error || 'Note not found' });
						continue;
					}
					if (plugin.isPathExcluded(file.path)) {
						results.push({ path: file.path, error: 'Note is in an excluded folder' });
						continue;
					}
					const content = await app.vault.cachedRead(file);
					const lines = content.split('\n');
					const words = content.split(/\s+/).filter(w => w.length > 0);

					// Headings from metadata cache
					const cache = app.metadataCache.getFileCache(file);
					const headings = cache?.headings || [];
					const headingsByLevel: Record<string, number> = {};
					for (const h of headings) {
						const key = `h${h.level}`;
						headingsByLevel[key] = (headingsByLevel[key] || 0) + 1;
					}

					// Paragraphs: non-empty blocks separated by blank lines
					let paragraphCount = 0;
					let inParagraph = false;
					for (const line of lines) {
						if (line.trim().length > 0) {
							if (!inParagraph) { paragraphCount++; inParagraph = true; }
						} else {
							inParagraph = false;
						}
					}

					// Code blocks: count fenced code block pairs
					let codeBlockCount = 0;
					for (const line of lines) {
						if (line.trimStart().startsWith('```')) codeBlockCount++;
					}
					codeBlockCount = Math.floor(codeBlockCount / 2);

					results.push({
						path: file.path,
						wordCount: words.length,
						charCount: content.length,
						lineCount: lines.length,
						headingCount: headings.length,
						headingsByLevel,
						paragraphCount,
						codeBlockCount,
						readingTimeMinutes: Math.max(1, Math.round(words.length / 200))
					});
				}
				return results;
			},

			async getNoteConnections(paths: string[]) {
				const results: any[] = [];
				for (const p of paths) {
					const { file, error: findError } = safeFindNote(p);
					if (!file) {
						results.push({ path: p, error: findError || 'Note not found' });
						continue;
					}
					if (plugin.isPathExcluded(file.path)) {
						results.push({ path: file.path, error: 'Note is in an excluded folder' });
						continue;
					}
					const cache = app.metadataCache.getFileCache(file);

					// Tags: combine frontmatter + inline
					const tagSet = new Set<string>();
					if (cache?.frontmatter?.tags) {
						const fmTags = Array.isArray(cache.frontmatter.tags) ? cache.frontmatter.tags : [cache.frontmatter.tags];
						for (const t of fmTags) tagSet.add(String(t).replace(/^#/, ''));
					}
					if (cache?.tags) {
						for (const t of cache.tags) tagSet.add(t.tag.replace(/^#/, ''));
					}
					const tagList = [...tagSet].sort();

					// Outgoing links
					const outgoing = (cache?.links || []).map(l => l.link);
					const outgoingUnique = [...new Set(outgoing)];

					// Backlinks
					const backlinkPaths = plugin.getBacklinkPaths(file);

					// Embeds
					const embeds = (cache?.embeds || []).map(e => e.link);
					const embedsUnique = [...new Set(embeds)];

					results.push({
						path: file.path,
						tags: { count: tagList.length, list: tagList },
						outgoingLinks: { count: outgoingUnique.length, list: outgoingUnique },
						backlinks: { count: backlinkPaths.length, list: backlinkPaths },
						embeds: { count: embedsUnique.length, list: embedsUnique }
					});
				}
				return results;
			},

			async getSelection() {
				const mdView = app.workspace.getActiveViewOfType(MarkdownView);
				if (!mdView) return null;
				const editor = mdView.editor;
				if (!editor) return null;
				const text = editor.getSelection();
				if (!text) return null;
				const file = mdView.file;
				if (!file) return null;
				const from = editor.getCursor('from');
				const to = editor.getCursor('to');
				return {
					text,
					file: file.path,
					startLine: from.line + 1,
					endLine: to.line + 1
				};
			},

			async previewPendingEdits(path?: string) {
				const files = path
					? [app.vault.getAbstractFileByPath(path)].filter((f): f is TFile => f instanceof TFile)
					: app.vault.getMarkdownFiles();
				const edits: { file: string; edit: any }[] = [];
				for (const file of files) {
					const content = await app.vault.cachedRead(file);
					if (!content.includes('```ai-edit')) continue;
					const fileEdits = plugin.editManager.extractEditsFromContent(content);
					for (const e of fileEdits) {
						edits.push({ file: file.path, edit: e });
						if (edits.length >= 30) break;
					}
					if (edits.length >= 30) break;
				}
				if (edits.length === 0) {
					return path
						? `No pending edits in "${path}".`
						: 'No pending edits in the vault.';
				}
				const lines: string[] = [`Found ${edits.length} pending edit(s):`];
				for (const { file, edit } of edits) {
					const before = (edit.before || '').substring(0, 200) + (edit.before && edit.before.length > 200 ? '...' : '');
					const after = (edit.after || '').substring(0, 200) + (edit.after && edit.after.length > 200 ? '...' : '');
					lines.push(`\n[${edit.type.toUpperCase()}] ${file} (id=${edit.id})`);
					if (before) lines.push(`  BEFORE: ${before}`);
					if (after) lines.push(`  AFTER: ${after}`);
				}
				return lines.join('\n');
			},

			async findOrphanNotes() {
				const files = app.vault.getMarkdownFiles();
				const resolvedLinks = app.metadataCache.resolvedLinks;
				// Build a set of all files that have incoming links
				const hasIncoming = new Set<string>();
				for (const sourcePath in resolvedLinks) {
					const targets = resolvedLinks[sourcePath];
					for (const targetPath in targets) {
						hasIncoming.add(targetPath);
					}
				}
				const orphans: string[] = [];
				for (const file of files) {
					if (plugin.isPathExcluded(file.path)) continue;
					const outgoing = resolvedLinks[file.path];
					const hasOutgoing = outgoing && Object.keys(outgoing).length > 0;
					if (!hasOutgoing && !hasIncoming.has(file.path)) {
						orphans.push(file.path);
					}
				}
				return orphans;
			},

			async findUnlinkedMentions(noteName: string, targetPath?: string) {
				const files = getSupportedFiles();
				// Escape regex special chars in note name
				const escaped = noteName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				const mentionRegex = new RegExp(`\\b${escaped}\\b`, 'gi');
				const wikiLinkRegex = /\[\[[^\]]*\]\]/g;
				const results: { file: string; line: number; context: string }[] = [];
				// Determine the file to skip (the note itself)
				const skipPath = targetPath || files.find(f => f.basename === noteName)?.path;
				for (const file of files) {
					if (plugin.isPathExcluded(file.path)) continue;
					if (skipPath && file.path === skipPath) continue;
					const content = await app.vault.cachedRead(file);
					const lines = content.split('\n');
					for (let i = 0; i < lines.length; i++) {
						const line = lines[i];
						// Strip wikilinks from the line before checking
						const stripped = line.replace(wikiLinkRegex, '');
						if (mentionRegex.test(stripped)) {
							mentionRegex.lastIndex = 0; // reset regex state
							const context = line.trim().substring(0, 150);
							results.push({ file: file.path, line: i + 1, context });
							if (results.length >= 100) break; // hard cap
						}
					}
					if (results.length >= 100) break;
				}
				return results;
			},

			async askUser(question: string, choices?: string[]) {
				return new Promise<string>((resolve) => {
					// If agent is already cancelled, resolve immediately
					if (view.agentAbortController?.signal.aborted) {
						resolve('[Agent cancelled]');
						return;
					}
					// Listen for abort to clean up UI and resolve
					const onAbort = () => {
						view.hideClarificationUI();
						resolve('[Agent cancelled]');
					};
					view.agentAbortController?.signal.addEventListener('abort', onAbort, { once: true });

					view.showUserClarificationUI({ question, options: choices }, (answer: string) => {
						view.agentAbortController?.signal.removeEventListener('abort', onAbort);
						resolve(answer);
					});
				});
			},

			onProgress(event: AgentProgressEvent) {
				if (event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'thinking' || event.type === 'iteration') {
					view.showAgentProgress(event.type, event.message, event.detail, event.fullContent);
				}
			}
		};
	}

	// Update progress container when agent finishes
	private completeAgentProgressFromResult(result: AgentResult) {
		if (!this.agentProgressContainer) return;

		this.agentProgressContainer.addClass('completed');

		const header = this.agentProgressContainer.querySelector('.ai-agent-progress-header');
		if (header) {
			header.empty();
			if (result.success) {
				header.createSpan({ cls: 'ai-agent-progress-icon', text: '\u2713' });
				header.createSpan({ cls: 'ai-agent-progress-title', text: ' Agent complete' });
			} else {
				header.createSpan({ cls: 'ai-agent-progress-icon', text: '\u2717' });
				header.createSpan({ cls: 'ai-agent-progress-title', text: ' Agent failed' });
			}
		}

		// Collapse the actions toggle
		if (this.agentActionsToggle) {
			this.agentActionsToggle.open = false;
		}

		// Append detail sections (notes, web sources, edits)
		if (result.notesRead && result.notesRead.length > 0) {
			const notesSection = this.agentProgressContainer.createEl('details', { cls: 'ai-chat-detail-section' });
			const notesSummary = notesSection.createEl('summary');
			notesSummary.setText(`${result.notesRead.length} note${result.notesRead.length !== 1 ? 's' : ''} accessed`);
			const notesList = notesSection.createEl('ul', { cls: 'ai-chat-detail-list' });
			for (const notePath of result.notesRead) {
				const li = notesList.createEl('li');
				li.createEl('a', {
					text: notePath,
					cls: 'internal-link',
					href: notePath
				});
			}
		}

		if (result.webSourcesUsed && result.webSourcesUsed.length > 0) {
			const sourcesSection = this.agentProgressContainer.createEl('details', { cls: 'ai-chat-detail-section' });
			const sourcesSummary = sourcesSection.createEl('summary');
			sourcesSummary.setText(`${result.webSourcesUsed.length} web source${result.webSourcesUsed.length !== 1 ? 's' : ''}`);
			const sourcesList = sourcesSection.createEl('ul', { cls: 'ai-chat-detail-list' });
			for (const source of result.webSourcesUsed) {
				const li = sourcesList.createEl('li');
				const link = li.createEl('a', {
					text: source.title,
					href: source.url,
				});
				link.setAttr('target', '_blank');
				link.setAttr('rel', 'noopener noreferrer');
			}
		}

		if (result.editsProposed && result.editsProposed.length > 0) {
			const editCount = result.editsProposed.length;
			const fileCount = new Set(result.editsProposed.map(e => e.file)).size;
			const searchTag = this.plugin.settings.pendingEditTag;
			const editsSection = this.agentProgressContainer.createEl('details', { cls: 'ai-chat-detail-section' });
			const editsSummary = editsSection.createEl('summary');
			editsSummary.setText(`${editCount} edit${editCount !== 1 ? 's' : ''} across ${fileCount} file${fileCount !== 1 ? 's' : ''}`);
			const editsList = editsSection.createEl('ul', { cls: 'ai-chat-detail-list' });
			for (const edit of result.editsProposed) {
				const li = editsList.createEl('li');
				li.setText(`${edit.file} \u2014 ${edit.position}`);
			}
			const viewAllLi = editsList.createEl('li');
			const viewAllLink = viewAllLi.createEl('a', {
				text: 'Search all pending edits',
			});
			viewAllLink.addEventListener('click', (e) => {
				e.preventDefault();
				const searchPlugin = (this.app as any).internalPlugins.getPluginById('global-search');
				if (searchPlugin?.instance) {
					searchPlugin.instance.openGlobalSearch(searchTag);
				}
			});
		}

		this.scrollChatToBottom();
	}

	// Build the response message from agent result
	private buildAgentResponseMessage(result: AgentResult, activeFilePath?: string) {
		if (!result.success && result.error) {
			this.addMessageToChat('assistant', `Error: ${result.error}`, { activeFile: activeFilePath });
			return;
		}

		// Use plain summary as markdown content; structured details rendered as DOM in renderMessage
		this.addMessageToChat('assistant', result.summary, {
			activeFile: activeFilePath,
			proposedEdits: result.editsProposed,
			editResults: {
				success: result.editsProposed.length,
				failed: 0,
				failures: [],
				accepted: 0,
				rejected: 0,
				pending: result.editsProposed.length
			},
			tokenUsage: {
				totalTokens: result.tokenUsage.total,
				promptTokens: result.tokenUsage.promptTokens,
				completionTokens: result.tokenUsage.completionTokens,
				cachedTokens: result.tokenUsage.cachedTokens
			},
			model: this.plugin.settings.aiModel,
			webSources: result.webSourcesUsed,
			notesRead: result.notesRead
		});
	}

	// Update edit feedback in chat history when user accepts/rejects an edit
	updateEditFeedbackInChat(filePath: string, action: 'accept' | 'reject') {
		// Walk backwards to find the most recent assistant message with proposed edits matching the file
		for (let i = this.chatMessages.length - 1; i >= 0; i--) {
			const msg = this.chatMessages[i];
			if (msg.role === 'assistant' && msg.proposedEdits && msg.editResults) {
				const hasMatchingEdit = msg.proposedEdits.some(e => {
					// Match by file path (could be basename match)
					return e.file === filePath || filePath.endsWith('/' + e.file) || filePath.endsWith(e.file);
				});
				if (hasMatchingEdit) {
					if (action === 'accept') {
						msg.editResults.accepted = (msg.editResults.accepted || 0) + 1;
					} else {
						msg.editResults.rejected = (msg.editResults.rejected || 0) + 1;
					}
					msg.editResults.pending = Math.max(0, (msg.editResults.pending || 0) - 1);
					break;
				}
			}
		}
	}

	// Render a pending deletion confirmation bubble in the chat
	private renderPendingDeletionBubble(file: TFile) {
		if (!this.chatContainer) return;

		const bubble = this.chatContainer.createDiv({ cls: 'ai-pending-deletion-bubble' });

		// Header row: trash icon + file info
		const header = bubble.createDiv({ cls: 'ai-pending-deletion-header' });
		header.createSpan({ cls: 'ai-pending-deletion-icon', text: '\uD83D\uDDD1\uFE0F' });
		const info = header.createDiv({ cls: 'ai-pending-deletion-info' });
		info.createDiv({ cls: 'ai-pending-deletion-title', text: `Delete "${file.basename}"?` });
		info.createDiv({ cls: 'ai-pending-deletion-path', text: file.path });

		// Accept/Reject buttons
		const actions = bubble.createDiv({ cls: 'ai-pending-deletion-actions' });

		const rejectBtn = actions.createEl('button', { cls: 'ai-pending-deletion-reject', text: 'Keep' });
		const acceptBtn = actions.createEl('button', { cls: 'ai-pending-deletion-accept', text: 'Delete' });

		acceptBtn.addEventListener('click', async () => {
			try {
				await this.app.vault.trash(file, false);
				bubble.empty();
				bubble.addClass('ai-pending-deletion-resolved');
				bubble.createSpan({ cls: 'ai-pending-deletion-result', text: `\uD83D\uDDD1\uFE0F "${file.basename}" moved to trash` });
				new Notice(`"${file.basename}" moved to trash`);
			} catch (e) {
				new Notice(`Failed to delete: ${(e as Error).message}`);
			}
		});

		rejectBtn.addEventListener('click', () => {
			bubble.empty();
			bubble.addClass('ai-pending-deletion-resolved');
			bubble.createSpan({ cls: 'ai-pending-deletion-result', text: `"${file.basename}" \u2014 deletion rejected` });
		});

		this.scrollChatToBottom();
	}

	// Render a pending move confirmation bubble in the chat
	renderPendingMoveBubble(originalPath: string, newPath: string, file: TFile) {
		if (!this.chatContainer) return;

		const bubble = this.chatContainer.createDiv({ cls: 'ai-pending-action-bubble ai-pending-move' });

		// Header
		const header = bubble.createDiv({ cls: 'ai-pending-action-header' });
		header.createSpan({ cls: 'ai-pending-action-icon', text: '\uD83D\uDCC1' });
		const info = header.createDiv({ cls: 'ai-pending-action-info' });
		info.createDiv({ cls: 'ai-pending-action-title', text: 'Moved Note' });

		// Path diff
		const pathDiff = info.createDiv({ cls: 'ai-pending-action-detail' });
		pathDiff.createEl('span', { cls: 'ai-pending-action-old', text: originalPath });
		pathDiff.createSpan({ text: ' \u2192 ' });
		pathDiff.createEl('span', { cls: 'ai-pending-action-new', text: newPath });

		// Buttons
		const actions = bubble.createDiv({ cls: 'ai-pending-action-actions' });
		const undoBtn = actions.createEl('button', { cls: 'ai-pending-action-undo', text: 'Undo' });
		const keepBtn = actions.createEl('button', { cls: 'ai-pending-action-keep', text: 'Keep' });

		keepBtn.addEventListener('click', () => {
			keepBtn.disabled = true;
			undoBtn.disabled = true;
			bubble.empty();
			bubble.addClass('ai-pending-action-resolved');
			bubble.createSpan({ cls: 'ai-pending-action-result', text: `\uD83D\uDCC1 Move kept: ${newPath}` });
		});

		undoBtn.addEventListener('click', async () => {
			keepBtn.disabled = true;
			undoBtn.disabled = true;
			try {
				const originalFolder = originalPath.substring(0, originalPath.lastIndexOf('/'));
				if (originalFolder && !this.app.vault.getAbstractFileByPath(originalFolder)) {
					await this.app.vault.createFolder(originalFolder);
				}
				await this.app.fileManager.renameFile(file, originalPath);
				bubble.empty();
				bubble.addClass('ai-pending-action-resolved');
				bubble.createSpan({ cls: 'ai-pending-action-result', text: `\u21A9\uFE0F Move reverted: ${originalPath}` });
				new Notice(`Move reverted: "${file.basename}"`);
			} catch (e) {
				new Notice(`Failed to undo move: ${(e as Error).message}`);
				keepBtn.disabled = false;
				undoBtn.disabled = false;
			}
		});

		this.scrollChatToBottom();
	}

	// Render a pending properties update bubble in the chat
	renderPendingPropertiesBubble(file: TFile, appliedProps: Record<string, unknown>, previousValues: Record<string, unknown>) {
		if (!this.chatContainer) return;

		const bubble = this.chatContainer.createDiv({ cls: 'ai-pending-action-bubble ai-pending-properties' });

		// Header
		const header = bubble.createDiv({ cls: 'ai-pending-action-header' });
		header.createSpan({ cls: 'ai-pending-action-icon', text: '\u2699\uFE0F' });
		const info = header.createDiv({ cls: 'ai-pending-action-info' });
		info.createDiv({ cls: 'ai-pending-action-title', text: `Properties Updated \u2014 ${file.basename}` });

		// Property diff rows
		const diffContainer = info.createDiv({ cls: 'ai-pending-action-detail' });
		for (const [key, newVal] of Object.entries(appliedProps)) {
			const oldVal = previousValues[key];
			const row = diffContainer.createDiv({ cls: 'ai-pending-prop-row' });
			row.createSpan({ cls: 'ai-pending-prop-key', text: key + ':' });
			if (oldVal !== null && oldVal !== undefined) {
				row.createSpan({ cls: 'ai-pending-action-old', text: String(oldVal) });
				row.createSpan({ text: ' \u2192 ' });
			}
			if (newVal === null) {
				row.createSpan({ cls: 'ai-pending-action-removed', text: 'removed' });
			} else {
				row.createSpan({ cls: 'ai-pending-action-new', text: String(newVal) });
			}
		}

		// Buttons
		const actions = bubble.createDiv({ cls: 'ai-pending-action-actions' });
		const undoBtn = actions.createEl('button', { cls: 'ai-pending-action-undo', text: 'Undo' });
		const keepBtn = actions.createEl('button', { cls: 'ai-pending-action-keep', text: 'Keep' });

		keepBtn.addEventListener('click', () => {
			keepBtn.disabled = true;
			undoBtn.disabled = true;
			bubble.empty();
			bubble.addClass('ai-pending-action-resolved');
			bubble.createSpan({ cls: 'ai-pending-action-result', text: `\u2699\uFE0F Changes kept: ${file.basename}` });
		});

		undoBtn.addEventListener('click', async () => {
			keepBtn.disabled = true;
			undoBtn.disabled = true;
			try {
				await this.app.fileManager.processFrontMatter(file, (fm) => {
					for (const [key, oldVal] of Object.entries(previousValues)) {
						if (oldVal === null || oldVal === undefined) {
							delete fm[key];
						} else {
							fm[key] = oldVal;
						}
					}
				});
				bubble.empty();
				bubble.addClass('ai-pending-action-resolved');
				bubble.createSpan({ cls: 'ai-pending-action-result', text: `\u21A9\uFE0F Properties reverted: ${file.basename}` });
				new Notice(`Properties reverted: "${file.basename}"`);
			} catch (e) {
				new Notice(`Failed to undo properties: ${(e as Error).message}`);
				keepBtn.disabled = false;
				undoBtn.disabled = false;
			}
		});

		this.scrollChatToBottom();
	}

	// Render a pending tags addition bubble in the chat
	renderPendingTagsBubble(file: TFile, addedTags: string[], previousTags: string[]) {
		if (!this.chatContainer) return;

		const bubble = this.chatContainer.createDiv({ cls: 'ai-pending-action-bubble ai-pending-tags' });

		// Header
		const header = bubble.createDiv({ cls: 'ai-pending-action-header' });
		header.createSpan({ cls: 'ai-pending-action-icon', text: '\uD83C\uDFF7\uFE0F' });
		const info = header.createDiv({ cls: 'ai-pending-action-info' });
		info.createDiv({ cls: 'ai-pending-action-title', text: `Tags Added \u2014 ${file.basename}` });

		// Tag chips
		const tagsContainer = info.createDiv({ cls: 'ai-pending-action-detail ai-pending-tags-list' });
		for (const tag of addedTags) {
			tagsContainer.createSpan({ cls: 'ai-pending-tag-chip', text: `+${tag}` });
		}

		// Buttons
		const actions = bubble.createDiv({ cls: 'ai-pending-action-actions' });
		const undoBtn = actions.createEl('button', { cls: 'ai-pending-action-undo', text: 'Undo' });
		const keepBtn = actions.createEl('button', { cls: 'ai-pending-action-keep', text: 'Keep' });

		keepBtn.addEventListener('click', () => {
			keepBtn.disabled = true;
			undoBtn.disabled = true;
			bubble.empty();
			bubble.addClass('ai-pending-action-resolved');
			bubble.createSpan({ cls: 'ai-pending-action-result', text: `\uD83C\uDFF7\uFE0F Tags kept: ${file.basename}` });
		});

		undoBtn.addEventListener('click', async () => {
			keepBtn.disabled = true;
			undoBtn.disabled = true;
			try {
				await this.app.fileManager.processFrontMatter(file, (fm) => {
					fm.tags = previousTags.length > 0 ? [...previousTags] : undefined;
					if (fm.tags === undefined) delete fm.tags;
				});
				bubble.empty();
				bubble.addClass('ai-pending-action-resolved');
				bubble.createSpan({ cls: 'ai-pending-action-result', text: `\u21A9\uFE0F Tags reverted: ${file.basename}` });
				new Notice(`Tags reverted: "${file.basename}"`);
			} catch (e) {
				new Notice(`Failed to undo tags: ${(e as Error).message}`);
				keepBtn.disabled = false;
				undoBtn.disabled = false;
			}
		});

		this.scrollChatToBottom();
	}

	// Render a copy notes bubble in the chat
	private renderCopyNotesBubble(paths: string[], content: string) {
		if (!this.chatContainer) return;

		const bubble = this.chatContainer.createDiv({ cls: 'ai-copy-notes-bubble' });

		// Header row: icon + title + copy button
		const header = bubble.createDiv({ cls: 'ai-copy-notes-header' });
		header.createSpan({ cls: 'ai-copy-notes-icon', text: '\uD83D\uDCCB' });
		header.createSpan({ cls: 'ai-copy-notes-title', text: `Collected Notes (${paths.length})` });

		const copyBtn = header.createEl('button', { cls: 'ai-copy-notes-btn', text: 'Copy to Clipboard' });
		copyBtn.addEventListener('click', async () => {
			try {
				await navigator.clipboard.writeText(content);
				new Notice(`Copied ${paths.length} note(s) to clipboard`);
				copyBtn.setText('Copied!');
				copyBtn.addClass('copied');
				setTimeout(() => {
					copyBtn.setText('Copy to Clipboard');
					copyBtn.removeClass('copied');
				}, 2000);
			} catch {
				new Notice('Failed to copy to clipboard');
			}
		});

		// Collapsible note list
		const details = bubble.createEl('details', { cls: 'ai-copy-notes-toggle' });
		details.createEl('summary', { text: 'Show notes' });

		const listEl = details.createDiv({ cls: 'ai-copy-notes-list' });

		// Render each note as a clickable wikilink using MarkdownRenderer
		const markdownLines = paths.map(p => {
			const name = p.replace(/\.md$/, '').split('/').pop() || p;
			return `- [[${name}]]`;
		}).join('\n');

		MarkdownRenderer.render(
			this.app,
			markdownLines,
			listEl,
			this.getSourcePath(),
			this
		);

		this.scrollChatToBottom();
	}

	// Show user clarification UI when agent asks a question
	showUserClarificationUI(question: { question: string; options?: string[] }, resolve?: (answer: string) => void) {
		// Remove any existing clarification UI
		this.hideClarificationUI();

		// Create container
		this.clarificationContainer = this.chatContainer?.createDiv({ cls: 'ai-clarification-container' }) || null;
		if (!this.clarificationContainer) return;

		// Header
		const header = this.clarificationContainer.createDiv({ cls: 'ai-clarification-header' });
		header.createSpan({ text: 'Agent needs clarification:', cls: 'ai-clarification-title' });

		// Question text
		const questionEl = this.clarificationContainer.createDiv({ cls: 'ai-clarification-question' });
		questionEl.setText(question.question);

		// Options (if provided)
		if (question.options && question.options.length > 0) {
			const optionsContainer = this.clarificationContainer.createDiv({ cls: 'ai-clarification-options' });

			question.options.forEach((option, index) => {
				const optionBtn = optionsContainer.createEl('button', {
					cls: 'ai-clarification-option',
					text: `${index + 1}. ${option}`
				});
				optionBtn.addEventListener('click', () => {
					this.hideClarificationUI();
					if (resolve) resolve(option);
				});
			});
		}

		// Text input for custom response
		const inputContainer = this.clarificationContainer.createDiv({ cls: 'ai-clarification-input-container' });
		const input = inputContainer.createEl('input', {
			type: 'text',
			placeholder: 'Or type your answer...',
			cls: 'ai-clarification-input'
		});

		const sendBtn = inputContainer.createEl('button', {
			text: 'Send',
			cls: 'ai-clarification-send'
		});

		const handleSend = () => {
			const value = input.value.trim();
			if (value) {
				this.hideClarificationUI();
				if (resolve) resolve(value);
			}
		};

		sendBtn.addEventListener('click', handleSend);
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				handleSend();
			}
		});

		// Focus input
		input.focus();

		// Scroll to show the clarification UI
		this.scrollChatToBottom();
	}

	// Hide clarification UI
	hideClarificationUI() {
		if (this.clarificationContainer) {
			this.clarificationContainer.remove();
			this.clarificationContainer = null;
		}
	}


	async onClose() {
		// Cleanup
	}
}

// Settings Tab
class AIAssistantSettingTab extends PluginSettingTab {
	plugin: MyPlugin;
	// Conditional section elements
	private editRulesEl: HTMLElement | null = null;
	private webSearchEl: HTMLElement | null = null;
	private cmdWhitelistEl: HTMLElement | null = null;
	private toolToggleWrapper: HTMLElement | null = null;
	private manualContextEl: HTMLElement | null = null;
	private semanticSettingsEls: HTMLElement[] | null = null;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'ObsidianAgent Settings' });

		// ============================================
		// SECTION 1: AI Models
		// ============================================
		containerEl.createEl('h3', { text: 'AI Models' });

		new Setting(containerEl)
			.setName('OpenAI API Key')
			.setDesc('Your OpenAI API key for ChatGPT')
			.addText(text => {
				text.inputEl.type = 'password';
				text.inputEl.autocomplete = 'off';
				return text
					.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.openaiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.openaiApiKey = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('AI Model')
			.setDesc('Model for answers and edits')
			.addDropdown(dropdown => dropdown
				.addOption('gpt-5-mini', 'gpt-5-mini (recommended)')
				.addOption('gpt-5-nano', 'gpt-5-nano (cheapest)')
				.addOption('gpt-5', 'gpt-5 (reasoning)')
				.addOption('gpt-5.1', 'gpt-5.1')
				.addOption('gpt-5.2', 'gpt-5.2')
				.addOption('gpt-4.1-nano', 'gpt-4.1-nano')
				.addOption('gpt-4.1-mini', 'gpt-4.1-mini')
				.addOption('gpt-4.1', 'gpt-4.1')
				.addOption('gpt-4o-mini', 'gpt-4o-mini')
				.addOption('gpt-4o', 'gpt-4o')
				.addOption('o1-mini', 'o1-mini')
				.addOption('o1', 'o1')
				.addOption('o3-mini', 'o3-mini')
				.addOption('o3', 'o3')
				.addOption('o4-mini', 'o4-mini')
				.setValue(this.plugin.settings.aiModel)
				.onChange(async (value) => {
					this.plugin.settings.aiModel = value;
					await this.plugin.saveSettings();
				}));

		// Web Search toggle
		const webSearchChildEls: HTMLElement[] = [];

		new Setting(containerEl)
			.setName('Enable Web Search')
			.setDesc('Enable web search and webpage reading tools')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableWebSearch)
				.onChange(async (value) => {
					this.plugin.settings.enableWebSearch = value;
					await this.plugin.saveSettings();
					webSearchChildEls.forEach(el => el.style.display = value ? '' : 'none');
					this.updateConditionalSections();
					this.plugin.notifySettingsChanged('web');
				}));

		// Search API settings (for Web Agent)
		const webInfoEl = containerEl.createEl('p', {
			text: 'Web search is optional. Configure a search API to enable web_search and read_webpage tools.',
			cls: 'setting-item-description',
		});
		webInfoEl.style.marginBottom = '8px';
		webSearchChildEls.push(webInfoEl);

		let searchApiKeySetting: Setting | null = null;

		const searchApiSetting = new Setting(containerEl)
			.setName('Search API')
			.setDesc('Which search API to use for web searches')
			.addDropdown(dropdown => dropdown
				.addOption('openai', 'OpenAI Web Search (uses main API key)')
				.addOption('serper', 'Serper.dev (~$0.001/search)')
				.addOption('brave', 'Brave Search')
				.addOption('tavily', 'Tavily')
				.setValue(this.plugin.settings.webAgentSearchApi)
				.onChange(async (value) => {
					this.plugin.settings.webAgentSearchApi = value as SearchApiType;
					await this.plugin.saveSettings();
					if (searchApiKeySetting) {
						searchApiKeySetting.settingEl.style.display = value === 'openai' ? 'none' : '';
					}
					this.plugin.notifySettingsChanged('web');
				}));
		webSearchChildEls.push(searchApiSetting.settingEl);

		searchApiKeySetting = new Setting(containerEl)
			.setName('Search API Key')
			.setDesc('API key for your selected search service (not needed for OpenAI)')
			.addText(text => {
				text.inputEl.type = 'password';
				text.inputEl.autocomplete = 'off';
				return text
					.setPlaceholder('Enter API key...')
					.setValue(this.plugin.settings.webAgentSearchApiKey)
					.onChange(async (value) => {
						this.plugin.settings.webAgentSearchApiKey = value;
						await this.plugin.saveSettings();
						this.plugin.notifySettingsChanged('web');
					});
			});
		webSearchChildEls.push(searchApiKeySetting.settingEl);

		if (this.plugin.settings.webAgentSearchApi === 'openai') {
			searchApiKeySetting.settingEl.style.display = 'none';
		}

		// Hide web search children if toggle is off
		if (!this.plugin.settings.enableWebSearch) {
			webSearchChildEls.forEach(el => el.style.display = 'none');
		}

		// Embeddings toggle
		const embeddingsChildEls: HTMLElement[] = [];

		new Setting(containerEl)
			.setName('Enable Embeddings')
			.setDesc('Enable semantic (concept-based) search via embeddings')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableEmbeddings)
				.onChange(async (value) => {
					this.plugin.settings.enableEmbeddings = value;
					await this.plugin.saveSettings();
					embeddingsChildEls.forEach(el => el.style.display = value ? '' : 'none');
					// Also hide/show semantic settings in section 6a and chat view
					if (this.semanticSettingsEls) {
						this.semanticSettingsEls.forEach(el => el.style.display = value ? '' : 'none');
					}
					this.plugin.notifySettingsChanged('context');
				}));

		const embModelSetting = new Setting(containerEl)
			.setName('Embedding Model')
			.setDesc('Model for semantic search. Small is cheaper, large is more accurate.')
			.addDropdown(dropdown => dropdown
				.addOption('text-embedding-3-small', 'text-embedding-3-small (cheaper)')
				.addOption('text-embedding-3-large', 'text-embedding-3-large (more accurate)')
				.setValue(this.plugin.settings.embeddingModel)
				.onChange(async (value) => {
					this.plugin.settings.embeddingModel = value as EmbeddingModel;
					await this.plugin.saveSettings();
				}));
		embeddingsChildEls.push(embModelSetting.settingEl);

		// Reindex button and status
		const embInfoEl = containerEl.createEl('p', {
			text: 'Embeddings enable semantic (concept-based) search. This is optional — the plugin works fully without it.',
			cls: 'setting-item-description',
		});
		embInfoEl.style.marginBottom = '8px';
		embeddingsChildEls.push(embInfoEl);

		const reindexSetting = new Setting(containerEl)
			.setName('Reindex Embeddings')
			.setDesc('Rebuild the embedding index for all notes. Only changed notes will be re-embedded.')
			.addButton(button => button
				.setButtonText('Reindex')
				.onClick(async () => {
					await this.handleReindex(button);
				}));
		embeddingsChildEls.push(reindexSetting.settingEl);

		const indexStatusContainer = containerEl.createDiv();
		this.renderIndexStatus(indexStatusContainer);
		embeddingsChildEls.push(indexStatusContainer);

		// Hide embeddings children if toggle is off
		if (!this.plugin.settings.enableEmbeddings) {
			embeddingsChildEls.forEach(el => el.style.display = 'none');
		}

		// ============================================
		// SECTION 2: Customize AI
		// ============================================
		containerEl.createEl('h3', { text: 'Customize AI' });
		containerEl.createEl('p', {
			text: 'Customize AI behavior. Core functionality (JSON format, security rules) is built-in and cannot be changed.',
			cls: 'setting-item-description'
		});

		// Custom Instructions - full-width textarea
		const instructionsContainer = containerEl.createDiv({ cls: 'ai-settings-textarea-container' });
		instructionsContainer.createEl('div', { text: 'Custom Instructions', cls: 'setting-item-name' });
		instructionsContainer.createEl('div', {
			text: 'Optional: Custom instructions for the AI (personality, tone, edit preferences, etc.)',
			cls: 'setting-item-description'
		});
		const instructionsTextarea = instructionsContainer.createEl('textarea', {
			placeholder: 'e.g., "Be concise and direct" or "Prefer minimal edits"'
		});
		instructionsTextarea.value = this.plugin.settings.customInstructions;
		instructionsTextarea.addEventListener('change', async () => {
			this.plugin.settings.customInstructions = instructionsTextarea.value;
			await this.plugin.saveSettings();
		});

		// ============================================
		// SECTION 3: Chat
		// ============================================
		containerEl.createEl('h3', { text: 'Chat' });

		new Setting(containerEl)
			.setName('Chat History Length')
			.setDesc('Number of previous messages to include as context (0-100). Set to 0 to disable.')
			.addSlider(slider => slider
				.setLimits(0, 100, 1)
				.setValue(this.plugin.settings.chatHistoryLength)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.chatHistoryLength = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Clear chat on note switch')
			.setDesc('Clear chat history when switching to a different note. If off, shows a subtle context indicator instead.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.clearChatOnNoteSwitch)
				.onChange(async (value) => {
					this.plugin.settings.clearChatOnNoteSwitch = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Pending Edit Tag')
			.setDesc('Tag added after each pending edit block for searchability')
			.addText(text => text
				.setPlaceholder('#ai_edit')
				.setValue(this.plugin.settings.pendingEditTag)
				.onChange(async (value) => {
					this.plugin.settings.pendingEditTag = value;
					await this.plugin.saveSettings();
				}));

		// ============================================
		// SECTION 4: Privacy
		// ============================================
		containerEl.createEl('h3', { text: 'Privacy' });
		containerEl.createEl('p', {
			text: 'Control which notes and folders are hidden from the AI.',
			cls: 'setting-item-description'
		});

		const excludedListEl = containerEl.createDiv({ cls: 'excluded-folders-list' });
		this.renderExcludedFolders(excludedListEl);

		new Setting(containerEl)
			.setName('Add Excluded Folder')
			.setDesc('Pick a vault folder to exclude from AI access.')
			.addButton(button => button
				.setButtonText('+ Add Folder')
				.onClick(() => {
					this.showFolderPicker(excludedListEl);
				}));

		new Setting(containerEl)
			.setName('Privacy Tag')
			.setDesc('Notes with this tag will never be sent to the AI. Leave empty to disable.')
			.addText(text => text
				.setPlaceholder('#private')
				.setValue(this.plugin.settings.excludedTag)
				.onChange(async (value) => {
					this.plugin.settings.excludedTag = value.replace(/^#/, '').trim();
					await this.plugin.saveSettings();
				}));

		// ============================================
		// SECTION 5: Token & Display
		// ============================================
		containerEl.createEl('h3', { text: 'Token & Display' });

		new Setting(containerEl)
			.setName('Max Iterations')
			.setDesc('Maximum think-act-observe rounds the agent can take (5-20)')
			.addSlider(slider => slider
				.setLimits(5, 20, 1)
				.setValue(this.plugin.settings.agentMaxIterations)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.agentMaxIterations = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Total Token Budget')
			.setDesc('Maximum total tokens across all rounds (20000-500000)')
			.addSlider(slider => slider
				.setLimits(20000, 500000, 10000)
				.setValue(this.plugin.settings.agentMaxTokens)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.agentMaxTokens = value;
					await this.plugin.saveSettings();
				}));

		const tokenTogglePricingContainer = containerEl.createDiv();

		new Setting(tokenTogglePricingContainer)
			.setName('Show token usage & cost estimate')
			.setDesc('Display token count and estimated cost below each AI response. Note: This feature is still in development, not fully tested, and is known to often overestimate costs.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showTokenUsage)
				.onChange(async (value) => {
					this.plugin.settings.showTokenUsage = value;
					await this.plugin.saveSettings();
					pricingDetails.style.display = value ? '' : 'none';
				}));

		// Pricing table (collapsible, only visible when token usage toggle is ON)
		const pricingDetails = tokenTogglePricingContainer.createEl('details', { cls: 'ai-settings-collapsible ai-pricing-table-wrapper' });
		pricingDetails.style.display = this.plugin.settings.showTokenUsage ? '' : 'none';
		const pricingSummary = pricingDetails.createEl('summary');
		pricingSummary.setText('Model Pricing ($/1M tokens)');

		const pricingContent = pricingDetails.createDiv({ cls: 'ai-settings-collapsible-content' });

		const buildPricingTable = () => {
			pricingContent.empty();

			const table = pricingContent.createEl('table', { cls: 'ai-pricing-table' });
			const thead = table.createEl('thead');
			const headerRow = thead.createEl('tr');
			headerRow.createEl('th', { text: 'Model' });
			headerRow.createEl('th', { text: 'Input' });
			headerRow.createEl('th', { text: 'Output' });

			const tbody = table.createEl('tbody');
			const overrides = this.plugin.settings.customModelPricing;

			for (const [model, defaults] of Object.entries(MODEL_PRICING)) {
				const row = tbody.createEl('tr');
				row.createEl('td', { text: model, cls: 'ai-pricing-model-name' });

				const inputTd = row.createEl('td');
				const inputEl = inputTd.createEl('input', { type: 'number', cls: 'ai-pricing-input' }) as HTMLInputElement;
				inputEl.value = String(overrides[model]?.input ?? defaults.input);
				inputEl.step = '0.01';
				inputEl.min = '0';
				inputEl.addEventListener('change', async () => {
					const val = parseFloat(inputEl.value);
					if (isNaN(val) || val < 0) { inputEl.value = String(defaults.input); return; }
					if (val === defaults.input && (!overrides[model] || overrides[model].output === defaults.output)) {
						delete overrides[model];
					} else {
						overrides[model] = { input: val, output: overrides[model]?.output ?? defaults.output };
					}
					await this.plugin.saveSettings();
				});

				const outputTd = row.createEl('td');
				const outputEl = outputTd.createEl('input', { type: 'number', cls: 'ai-pricing-input' }) as HTMLInputElement;
				outputEl.value = String(overrides[model]?.output ?? defaults.output);
				outputEl.step = '0.01';
				outputEl.min = '0';
				outputEl.addEventListener('change', async () => {
					const val = parseFloat(outputEl.value);
					if (isNaN(val) || val < 0) { outputEl.value = String(defaults.output); return; }
					if (val === defaults.output && (!overrides[model] || overrides[model].input === defaults.input)) {
						delete overrides[model];
					} else {
						overrides[model] = { input: overrides[model]?.input ?? defaults.input, output: val };
					}
					await this.plugin.saveSettings();
				});
			}

			const resetBtn = pricingContent.createEl('button', { text: 'Reset to defaults', cls: 'ai-pricing-reset-btn' });
			resetBtn.addEventListener('click', async () => {
				this.plugin.settings.customModelPricing = {};
				await this.plugin.saveSettings();
				buildPricingTable();
			});
		};

		buildPricingTable();

		// ============================================
		// SECTION 6: Agent Settings (Collapsible)
		// ============================================
		containerEl.createEl('h3', { text: 'Agent Settings' });

		// Manual Context toggle
		new Setting(containerEl)
			.setName('Enable Manual Context')
			.setDesc('Enable manual context panel in chat for controlling which notes are sent to the AI')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableManualContext)
				.onChange(async (value) => {
					this.plugin.settings.enableManualContext = value;
					await this.plugin.saveSettings();
					if (this.manualContextEl) {
						this.manualContextEl.style.display = value ? '' : 'none';
					}
					this.plugin.notifySettingsChanged('context');
				}));

		// 6a: Manual Context
		this.manualContextEl = containerEl.createEl('details', { cls: 'ai-settings-collapsible' });
		const focusedSummary = this.manualContextEl.createEl('summary');
		focusedSummary.setText('Manual Context');

		const focusedContent = this.manualContextEl.createDiv({ cls: 'ai-settings-collapsible-content' });

		new Setting(focusedContent)
			.setName('Link Depth')
			.setDesc('Default link depth (0-3)')
			.addSlider(slider => slider
				.setLimits(0, 3, 1)
				.setValue(this.plugin.settings.defaultLinkDepth)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.defaultLinkDepth = value;
					await this.plugin.saveSettings();
					this.plugin.notifySettingsChanged('context');
				}));

		new Setting(focusedContent)
			.setName('Max Linked Notes')
			.setDesc('Default max linked notes (0-50)')
			.addSlider(slider => slider
				.setLimits(0, 50, 1)
				.setValue(this.plugin.settings.defaultMaxLinkedNotes)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.defaultMaxLinkedNotes = value;
					await this.plugin.saveSettings();
					this.plugin.notifySettingsChanged('context');
				}));

		new Setting(focusedContent)
			.setName('Max Folder Notes')
			.setDesc('Default max folder notes (0-20)')
			.addSlider(slider => slider
				.setLimits(0, 20, 1)
				.setValue(this.plugin.settings.defaultMaxFolderNotes)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.defaultMaxFolderNotes = value;
					await this.plugin.saveSettings();
					this.plugin.notifySettingsChanged('context');
				}));

		// Semantic settings in Manual Context (hidden when embeddings disabled)
		this.semanticSettingsEls = [];

		const semanticNoteSetting = new Setting(focusedContent)
			.setName('Max Semantic Notes')
			.setDesc('Default max semantic notes (0-20)')
			.addSlider(slider => slider
				.setLimits(0, 20, 1)
				.setValue(this.plugin.settings.defaultSemanticMatchCount)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.defaultSemanticMatchCount = value;
					await this.plugin.saveSettings();
					this.plugin.notifySettingsChanged('context');
				}));
		this.semanticSettingsEls.push(semanticNoteSetting.settingEl);

		const semanticSimSetting = new Setting(focusedContent)
			.setName('Min Similarity Threshold')
			.setDesc('Default min similarity threshold (0-100%)')
			.addSlider(slider => slider
				.setLimits(0, 100, 1)
				.setValue(this.plugin.settings.defaultSemanticMinSimilarity)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.defaultSemanticMinSimilarity = value;
					await this.plugin.saveSettings();
					this.plugin.notifySettingsChanged('context');
				}));
		this.semanticSettingsEls.push(semanticSimSetting.settingEl);

		// Hide semantic settings if embeddings disabled
		if (!this.plugin.settings.enableEmbeddings) {
			this.semanticSettingsEls.forEach(el => el.style.display = 'none');
		}

		// Hide manual context section if toggle is off
		if (!this.plugin.settings.enableManualContext) {
			this.manualContextEl.style.display = 'none';
		}

		// 6b: Agent
		const agentEl = containerEl.createEl('details', { cls: 'ai-settings-collapsible' });
		const agentSummary = agentEl.createEl('summary');
		agentSummary.setText('Agent');

		const agentContent = agentEl.createDiv({ cls: 'ai-settings-collapsible-content' });

		// 6b-ii: Tool Toggles (all tools including advanced, in pill groups)
		this.toolToggleWrapper = agentContent.createDiv({ cls: 'ai-tool-toggles' });
		this.renderToolTogglePills(this.toolToggleWrapper);

		// 6c: Edit Rules (conditional — hidden when edit_note is disabled)
		this.editRulesEl = containerEl.createEl('details', { cls: 'ai-settings-collapsible' });
		const editRulesSummary = this.editRulesEl.createEl('summary');
		editRulesSummary.setText('Edit Rules');

		const editRulesContent = this.editRulesEl.createDiv({ cls: 'ai-settings-collapsible-content' });

		new Setting(editRulesContent)
			.setName('Editable Scope')
			.setDesc('Which notes the AI can edit')
			.addDropdown(dropdown => dropdown
				.addOption('vault', 'Whole vault')
				.addOption('current', 'Current note only')
				.setValue(this.plugin.settings.defaultEditableScope)
				.onChange(async (value) => {
					this.plugin.settings.defaultEditableScope = value as EditableScope;
					await this.plugin.saveSettings();
					this.plugin.notifySettingsChanged('editRules');
				}));

		new Setting(editRulesContent)
			.setName('Allow adding content')
			.setDesc('AI can insert new lines and content')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.defaultCanAdd)
				.onChange(async (value) => {
					this.plugin.settings.defaultCanAdd = value;
					await this.plugin.saveSettings();
					this.plugin.notifySettingsChanged('editRules');
				}));

		new Setting(editRulesContent)
			.setName('Allow deleting/replacing content')
			.setDesc('AI can delete or replace existing content')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.defaultCanDelete)
				.onChange(async (value) => {
					this.plugin.settings.defaultCanDelete = value;
					await this.plugin.saveSettings();
					this.plugin.notifySettingsChanged('editRules');
				}));

		// 6d: Web Search (conditional — hidden when web tools are disabled)
		this.webSearchEl = containerEl.createEl('details', { cls: 'ai-settings-collapsible' });
		const webAgentSummary = this.webSearchEl.createEl('summary');
		webAgentSummary.setText('Web Search');

		const webAgentContent = this.webSearchEl.createDiv({ cls: 'ai-settings-collapsible-content' });

		new Setting(webAgentContent)
			.setName('Search Results Limit')
			.setDesc('Maximum number of search results to retrieve (3-15)')
			.addSlider(slider => slider
				.setLimits(3, 15, 1)
				.setValue(this.plugin.settings.webAgentSnippetLimit)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.webAgentSnippetLimit = value;
					await this.plugin.saveSettings();
				}));

		new Setting(webAgentContent)
			.setName('Pages to Fetch')
			.setDesc('Maximum number of pages to fetch in full (1-5)')
			.addSlider(slider => slider
				.setLimits(1, 5, 1)
				.setValue(this.plugin.settings.webAgentFetchLimit)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.webAgentFetchLimit = value;
					await this.plugin.saveSettings();
				}));

		new Setting(webAgentContent)
			.setName('Web Content Token Budget')
			.setDesc('Maximum tokens for web content (2000-20000)')
			.addSlider(slider => slider
				.setLimits(2000, 20000, 1000)
				.setValue(this.plugin.settings.webAgentTokenBudget)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.webAgentTokenBudget = value;
					await this.plugin.saveSettings();
				}));

		// 6e: Command Whitelist (conditional — hidden when execute_command is disabled)
		this.cmdWhitelistEl = containerEl.createEl('details', { cls: 'ai-settings-collapsible' });
		const cmdWhitelistSummary = this.cmdWhitelistEl.createEl('summary');
		cmdWhitelistSummary.setText('Command Whitelist');

		const cmdWhitelistContent = this.cmdWhitelistEl.createDiv({ cls: 'ai-settings-collapsible-content' });
		this.renderCommandWhitelist(cmdWhitelistContent);

		// 6f: Custom Info Tools
		const customInfoDetails = containerEl.createEl('details', { cls: 'ai-settings-collapsible' });
		const customInfoSummary = customInfoDetails.createEl('summary');
		customInfoSummary.setText('Custom Info Tools');
		const customInfoContent = customInfoDetails.createDiv({ cls: 'ai-settings-collapsible-content' });
		this.renderCustomInfoTools(customInfoContent);

		// Apply conditional section visibility
		this.updateConditionalSections();

		// ============================================
		// SECTION 7: Developer
		// ============================================
		containerEl.createEl('h3', { text: 'Developer' });

		new Setting(containerEl)
			.setName('Debug Mode')
			.setDesc('Log prompts and AI responses to the developer console (Ctrl+Shift+I / Cmd+Option+I)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.debugMode)
				.onChange(async (value) => {
					this.plugin.settings.debugMode = value;
					await this.plugin.saveSettings();
				}));
	}

	async handleReindex(button: any) {
		if (!this.plugin.settings.openaiApiKey) {
			new Notice('Please set your OpenAI API key first');
			return;
		}

		button.setDisabled(true);
		button.setButtonText('Indexing...');

		const statusEl = this.containerEl.querySelector('.embedding-index-status');

		// Use Notice for progress display (updates reliably unlike button text)
		let progressNotice = new Notice('Indexing... 0/?', 0); // 0 = don't auto-hide

		try {
			const existingIndex = await loadEmbeddingIndex(
				this.app.vault,
				this.plugin.manifest.dir!,
				this.plugin.logger
			);

			// Compute tag-excluded paths
			const tagExcludedPaths = new Set<string>();
			for (const f of this.app.vault.getMarkdownFiles()) {
				if (this.plugin.isNotePrivate(f.path)) tagExcludedPaths.add(f.path);
			}

			const result = await reindexVault(
				this.app.vault,
				this.plugin.settings.excludedFolders,
				existingIndex,
				this.plugin.settings.openaiApiKey,
				this.plugin.settings.embeddingModel,
				(current, total, status) => {
					progressNotice.setMessage(`Indexing... ${current}/${total} notes`);
				},
				this.plugin.logger,
				tagExcludedPaths
			);

			await saveEmbeddingIndex(
				this.app.vault,
				this.plugin.manifest.dir!,
				result.index
			);

			// Update plugin's cached index
			this.plugin.embeddingIndex = result.index;

			// Hide warning in ObsidianAgent view if open
			const leaves = this.app.workspace.getLeavesOfType(AI_ASSISTANT_VIEW_TYPE);
			for (const leaf of leaves) {
				const view = leaf.view as AIAssistantView;
				view.updateSemanticSlidersState();
			}

			// Hide progress notice and show completion
			progressNotice.hide();
			new Notice(`Indexed ${result.stats.total} notes (${result.stats.updated} updated, ${result.stats.reused} reused)`);

			// Refresh status display
			if (statusEl) {
				this.renderIndexStatusContent(statusEl as HTMLElement, result.index);
			}
		} catch (error) {
			this.plugin.logger.error('SEMANTIC', 'Reindex failed', error);
			progressNotice.hide();
			new Notice(`Reindex failed: ${(error as Error).message}`);
		} finally {
			button.setDisabled(false);
			button.setButtonText('Reindex');
		}
	}

	renderIndexStatus(container: HTMLElement) {
		const statusEl = container.createDiv({ cls: 'embedding-index-status' });
		this.renderIndexStatusContent(statusEl, this.plugin.embeddingIndex);
	}

	renderIndexStatusContent(container: HTMLElement, index: EmbeddingIndex | null) {
		container.empty();

		if (!index) {
			container.createEl('p', {
				text: 'No embedding index found. Click "Reindex" to create one.',
				cls: 'setting-item-description'
			});
			return;
		}

		const noteCount = new Set(index.chunks.map(c => c.notePath)).size;
		const lastUpdated = new Date(index.lastUpdated).toLocaleString();

		container.createEl('p', {
			text: `Index: ${noteCount} notes, ${index.chunks.length} chunks (${index.model})`,
			cls: 'setting-item-description'
		});
		container.createEl('p', {
			text: `Last updated: ${lastUpdated}`,
			cls: 'setting-item-description'
		});
	}

	/**
	 * Purge embedding chunks that belong to a newly-excluded folder.
	 * Prevents stale embeddings from leaking into semantic search results.
	 */
	async purgeExcludedEmbeddings(folder: string) {
		const index = this.plugin.embeddingIndex;
		if (!index) return;

		const normalizedFolder = folder.endsWith('/') ? folder : folder + '/';
		const before = index.chunks.length;
		index.chunks = index.chunks.filter(
			c => !c.notePath.startsWith(normalizedFolder) &&
				c.notePath.substring(0, c.notePath.lastIndexOf('/')) !== folder
		);
		const removed = before - index.chunks.length;

		if (removed > 0) {
			await saveEmbeddingIndex(
				this.app.vault,
				this.plugin.manifest.dir!,
				index
			);
			new Notice(`Removed ${removed} embedding(s) from excluded folder "${folder}".`);
		}
	}

	renderExcludedFolders(container: HTMLElement) {
		container.empty();

		if (this.plugin.settings.excludedFolders.length === 0) {
			container.createEl('p', {
				text: 'No folders excluded.',
				cls: 'excluded-folders-empty'
			});
			return;
		}

		for (const folder of this.plugin.settings.excludedFolders) {
			const item = container.createDiv({ cls: 'excluded-folder-item' });
			item.createSpan({ text: folder, cls: 'excluded-folder-path' });

			const removeBtn = item.createEl('button', { text: 'Remove', cls: 'excluded-folder-remove' });
			removeBtn.addEventListener('click', async () => {
				const index = this.plugin.settings.excludedFolders.indexOf(folder);
				if (index > -1) {
					this.plugin.settings.excludedFolders.splice(index, 1);
					await this.plugin.saveSettings();
					this.renderExcludedFolders(container);
				}
			});
		}
	}

	/**
	 * Update conditional section visibility based on tool toggle state.
	 */
	private updateConditionalSections() {
		const disabled = new Set(this.plugin.settings.disabledTools || []);
		if (this.editRulesEl) {
			this.editRulesEl.style.display = disabled.has('edit_note') ? 'none' : '';
		}
		if (this.webSearchEl) {
			const webHidden = !this.plugin.settings.enableWebSearch || (disabled.has('web_search') && disabled.has('read_webpage'));
			this.webSearchEl.style.display = webHidden ? 'none' : '';
		}
		if (this.cmdWhitelistEl) {
			this.cmdWhitelistEl.style.display = disabled.has('execute_command') ? 'none' : '';
		}
	}

	/**
	 * Render (or re-render) pill-style toggle buttons for all agent tools.
	 * 4 groups: Vault, Web, Action, Advanced.
	 * Protected tools (done, ask_user) are always locked ON.
	 * Web tools forced OFF when web search is not configured.
	 * edit_note forced OFF when both canAdd and canDelete are off.
	 */
	private renderToolTogglePills(wrapper: HTMLElement) {
		wrapper.empty();

		const s = this.plugin.settings;
		const disabled = new Set(s.disabledTools || []);

		const webConfigured = s.webAgentSearchApi === 'openai'
			? !!s.openaiApiKey
			: !!s.webAgentSearchApiKey;

		const toolLabel: Record<string, string> = {
			search_vault: 'Search Vault',
			read_note: 'Read Note',
			list_notes: 'List Notes',
			get_links: 'Get Links',
			explore_structure: 'Explore Structure',
			list_tags: 'List Tags',
			get_manual_context: 'Manual Context',
			web_search: 'Web Search',
			read_webpage: 'Read Webpage',
			edit_note: 'Edit Note',
			create_note: 'Create Note',
			open_note: 'Open Note',
			move_note: 'Move Note',
			update_properties: 'Update Properties',
			add_tags: 'Add Tags',
			link_notes: 'Link Notes',
			copy_notes: 'Copy Notes',
			done: 'Done',
			ask_user: 'Ask User',
			get_properties: 'Get Properties',
			get_file_info: 'File Info',
			find_dead_links: 'Dead Links',
			query_notes: 'Query Notes',
			delete_note: 'Delete Note',
			execute_command: 'Execute Command',
			get_note_stats: 'Note Stats',
			get_note_connections: 'Note Connections',
			get_selection: 'Selection',
			preview_pending_edits: 'Preview Edits',
			find_orphan_notes: 'Orphan Notes',
			find_unlinked_mentions: 'Unlinked Mentions',
		};

		const vaultTools = [
			'search_vault', 'read_note', 'list_notes', 'get_links',
			'explore_structure', 'list_tags', 'get_manual_context', 'get_selection'
		];
		const webToolNames = ['web_search', 'read_webpage'];
		const actionTools = [
			'edit_note', 'create_note', 'open_note', 'move_note',
			'update_properties', 'add_tags', 'link_notes', 'copy_notes',
			'done', 'ask_user'
		];
		const advancedTools = [
			'get_properties', 'get_file_info', 'find_dead_links', 'query_notes',
			'get_note_stats', 'get_note_connections',
			'preview_pending_edits', 'find_orphan_notes', 'find_unlinked_mentions',
			'delete_note', 'execute_command'
		];

		// Only edit_note is gated by capability settings
		const capBlockedTools = new Set<string>();
		if (!s.defaultCanAdd && !s.defaultCanDelete) capBlockedTools.add('edit_note');

		const protectedTools = new Set(['done', 'ask_user']);

		const settingEl = new Setting(wrapper)
			.setName('Tool Toggles')
			.setDesc('Enable or disable individual agent tools. Protected tools (Done, Ask User) cannot be toggled off.');
		settingEl.settingEl.style.borderBottom = 'none';

		const renderGroup = (label: string, tools: string[]) => {
			const group = wrapper.createDiv({ cls: 'ai-tool-toggle-group' });
			group.createDiv({ cls: 'ai-tool-toggle-group-label', text: label });
			const pills = group.createDiv({ cls: 'ai-tool-toggle-pills' });

			for (const tool of tools) {
				const isProtected = protectedTools.has(tool);
				const isWebBlocked = webToolNames.includes(tool) && !webConfigured;
				const isCapBlocked = capBlockedTools.has(tool);
				const isForcedOff = isWebBlocked || isCapBlocked;
				const isOn = isProtected || (!isForcedOff && !disabled.has(tool));

				const pill = pills.createEl('span', {
					text: toolLabel[tool] || tool,
					cls: 'ai-tool-toggle-pill'
				});

				if (isProtected) {
					pill.addClass('is-locked');
					pill.title = 'Required for agent control flow';
				} else if (isForcedOff) {
					pill.addClass('is-forced-off');
					pill.title = isWebBlocked
						? 'Web search not configured'
						: 'Blocked by Edit Rules';
				} else if (isOn) {
					pill.addClass('is-on');
				} else {
					pill.addClass('is-off');
				}

				if (!isProtected && !isForcedOff) {
					pill.addEventListener('click', async () => {
						const currentlyDisabled = new Set(this.plugin.settings.disabledTools || []);
						if (currentlyDisabled.has(tool)) {
							currentlyDisabled.delete(tool);
						} else {
							currentlyDisabled.add(tool);
						}
						this.plugin.settings.disabledTools = [...currentlyDisabled];
						await this.plugin.saveSettings();
						this.renderToolTogglePills(wrapper);
						this.updateConditionalSections();
						this.plugin.notifySettingsChanged('editRules');
					});
				}
			}
		};

		renderGroup('Vault Tools', vaultTools);
		renderGroup('Web Tools', webToolNames);
		renderGroup('Action Tools', actionTools);
		renderGroup('Advanced Tools', advancedTools);

		// Custom info tools group (only if any exist)
		const customInfoTools = s.customInfoTools || [];
		if (customInfoTools.length > 0) {
			const group = wrapper.createDiv({ cls: 'ai-tool-toggle-group' });
			group.createDiv({ cls: 'ai-tool-toggle-group-label', text: 'Info Tools' });
			const pills = group.createDiv({ cls: 'ai-tool-toggle-pills' });

			for (const tool of customInfoTools) {
				const pill = pills.createEl('span', {
					text: tool.name,
					cls: 'ai-tool-toggle-pill'
				});
				pill.addClass(tool.enabled ? 'is-on' : 'is-off');
				pill.addEventListener('click', async () => {
					tool.enabled = !tool.enabled;
					await this.plugin.saveSettings();
					this.renderToolTogglePills(wrapper);
				});
			}
		}
	}

	/**
	 * Render command whitelist UI with card-styled items.
	 */
	private renderCommandWhitelist(container: HTMLElement) {
		container.empty();

		const whitelist = this.plugin.settings.whitelistedCommands || [];

		if (whitelist.length === 0) {
			container.createDiv({
				text: 'No commands whitelisted yet.',
				cls: 'ai-command-whitelist-empty'
			});
		} else {
			const listEl = container.createDiv({ cls: 'ai-command-whitelist-list' });
			for (const cmd of whitelist) {
				const item = listEl.createDiv({ cls: 'ai-command-whitelist-item' });
				const info = item.createDiv({ cls: 'ai-command-whitelist-info' });
				info.createDiv({ text: cmd.name, cls: 'ai-command-whitelist-name' });
				info.createDiv({ text: cmd.description, cls: 'ai-command-whitelist-desc' });

				const removeBtn = item.createEl('button', {
					text: '\u00d7',
					cls: 'ai-command-whitelist-remove',
					attr: { 'aria-label': `Remove ${cmd.name}` }
				});
				removeBtn.addEventListener('click', async () => {
					this.plugin.settings.whitelistedCommands = this.plugin.settings.whitelistedCommands.filter(
						c => c.id !== cmd.id
					);
					await this.plugin.saveSettings();
					this.renderCommandWhitelist(container);
				});
			}
		}

		// Add command button
		new Setting(container)
			.addButton(button => button
				.setButtonText('+ Add Command')
				.setCta()
				.onClick(() => {
					this.showCommandPicker(container);
				}));
	}

	/**
	 * Show a searchable folder picker modal for excluded folders.
	 */
	private showFolderPicker(excludedListEl: HTMLElement) {
		const allFolders = this.app.vault.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder)
			.map(f => f.path)
			.filter(p => p !== '/')
			.sort();

		const existingSet = new Set(this.plugin.settings.excludedFolders);
		const available = allFolders.filter(p => !existingSet.has(p));

		const { FuzzySuggestModal } = require('obsidian');
		const modal = new (class extends FuzzySuggestModal<string> {
			settingsTab: AIAssistantSettingTab;
			container: HTMLElement;

			constructor(app: App, settingsTab: AIAssistantSettingTab, container: HTMLElement) {
				super(app);
				this.settingsTab = settingsTab;
				this.container = container;
			}

			getItems() {
				return available;
			}

			getItemText(item: string) {
				return item;
			}

			async onChooseItem(item: string) {
				this.settingsTab.plugin.settings.excludedFolders.push(item);
				await this.settingsTab.plugin.saveSettings();
				await this.settingsTab.purgeExcludedEmbeddings(item);
				this.settingsTab.renderExcludedFolders(this.container);
			}
		})(this.app, this, excludedListEl);

		modal.setPlaceholder('Search folders...');
		modal.open();
	}

	/**
	 * Show a searchable command picker modal.
	 */
	private showCommandPicker(whitelistContainer: HTMLElement) {
		const commands = (this.app as any).commands.listCommands() as Array<{ id: string; name: string }>;

		// Filter out already-whitelisted commands
		const existingIds = new Set(this.plugin.settings.whitelistedCommands.map(c => c.id));
		const available = commands.filter(c => !existingIds.has(c.id));

		// Create a fuzzy suggest modal
		const { FuzzySuggestModal } = require('obsidian');
		const modal = new (class extends FuzzySuggestModal<{ id: string; name: string }> {
			settingsTab: AIAssistantSettingTab;
			whitelistContainer: HTMLElement;

			constructor(app: App, settingsTab: AIAssistantSettingTab, container: HTMLElement) {
				super(app);
				this.settingsTab = settingsTab;
				this.whitelistContainer = container;
			}

			getItems() {
				return available;
			}

			getItemText(item: { id: string; name: string }) {
				return item.name;
			}

			onChooseItem(item: { id: string; name: string }) {
				// Prompt for description
				this.settingsTab.showDescriptionInput(item, this.whitelistContainer);
			}
		})(this.app, this, whitelistContainer);

		modal.setPlaceholder('Search commands...');
		modal.open();
	}

	/**
	 * Show a simple input for the command description after picking a command.
	 */
	private showDescriptionInput(command: { id: string; name: string }, whitelistContainer: HTMLElement) {
		const { Modal } = require('obsidian');
		const modal = new (class extends Modal {
			settingsTab: AIAssistantSettingTab;
			command: { id: string; name: string };
			whitelistContainer: HTMLElement;

			constructor(app: App, settingsTab: AIAssistantSettingTab, cmd: { id: string; name: string }, container: HTMLElement) {
				super(app);
				this.settingsTab = settingsTab;
				this.command = cmd;
				this.whitelistContainer = container;
			}

			onOpen() {
				const { contentEl } = this;
				contentEl.createEl('h3', { text: `Add: ${this.command.name}` });
				contentEl.createEl('p', { text: 'Provide a short description so the agent knows when to use this command.' });

				const input = contentEl.createEl('input', { type: 'text', placeholder: 'e.g., Toggle all folds in the current note' });
				input.style.width = '100%';
				input.style.marginBottom = '12px';

				const btnContainer = contentEl.createDiv({ cls: 'modal-button-container' });
				const saveBtn = btnContainer.createEl('button', { text: 'Add', cls: 'mod-cta' });
				saveBtn.addEventListener('click', async () => {
					const desc = input.value.trim() || this.command.name;
					this.settingsTab.plugin.settings.whitelistedCommands.push({
						id: this.command.id,
						name: this.command.name,
						description: desc
					});
					await this.settingsTab.plugin.saveSettings();
					this.settingsTab.renderCommandWhitelist(this.whitelistContainer);
					this.close();
				});

				const cancelBtn = btnContainer.createEl('button', { text: 'Cancel' });
				cancelBtn.addEventListener('click', () => this.close());

				// Focus the input
				setTimeout(() => input.focus(), 50);
			}

			onClose() {
				this.contentEl.empty();
			}
		})(this.app, this, command, whitelistContainer);

		modal.open();
	}

	/**
	 * Render custom info tools list with card-styled items.
	 */
	private renderCustomInfoTools(container: HTMLElement) {
		container.empty();

		const tools = this.plugin.settings.customInfoTools || [];

		if (tools.length === 0) {
			container.createDiv({
				text: 'No custom info tools yet.',
				cls: 'ai-custom-info-empty'
			});
		} else {
			const listEl = container.createDiv({ cls: 'ai-custom-info-list' });
			for (const tool of tools) {
				const item = listEl.createDiv({ cls: 'ai-custom-info-item' });

				// Toggle
				const toggle = item.createEl('input', { type: 'checkbox', cls: 'ai-custom-info-toggle' });
				(toggle as HTMLInputElement).checked = tool.enabled;
				toggle.addEventListener('change', async () => {
					tool.enabled = (toggle as HTMLInputElement).checked;
					await this.plugin.saveSettings();
					if (this.toolToggleWrapper) this.renderToolTogglePills(this.toolToggleWrapper);
				});

				// Info section
				const info = item.createDiv({ cls: 'ai-custom-info-info' });
				info.createDiv({ text: tool.name, cls: 'ai-custom-info-name' });
				const sourceLabel = tool.contentType === 'note'
					? `Note: ${tool.notePath || '(none)'}`
					: `Inline (${(tool.inlineContent || '').length} chars)`;
				info.createDiv({ text: sourceLabel, cls: 'ai-custom-info-source' });
				info.createDiv({ text: tool.triggerDescription, cls: 'ai-custom-info-trigger' });

				// Edit button
				const editBtn = item.createEl('button', {
					text: 'Edit',
					cls: 'ai-custom-info-edit',
					attr: { 'aria-label': `Edit ${tool.name}` }
				});
				editBtn.addEventListener('click', () => {
					this.showCustomInfoToolModal(container, tool);
				});

				// Remove button
				const removeBtn = item.createEl('button', {
					text: '\u00d7',
					cls: 'ai-custom-info-remove',
					attr: { 'aria-label': `Remove ${tool.name}` }
				});
				removeBtn.addEventListener('click', async () => {
					this.plugin.settings.customInfoTools = this.plugin.settings.customInfoTools.filter(
						t => t.id !== tool.id
					);
					await this.plugin.saveSettings();
					this.renderCustomInfoTools(container);
					if (this.toolToggleWrapper) this.renderToolTogglePills(this.toolToggleWrapper);
				});
			}
		}

		// Add button
		new Setting(container)
			.addButton(button => button
				.setButtonText('+ Add Info Tool')
				.setCta()
				.onClick(() => {
					this.showCustomInfoToolModal(container);
				}));
	}

	/**
	 * Show a modal to create or edit a custom info tool.
	 */
	private showCustomInfoToolModal(listContainer: HTMLElement, existingTool?: CustomInfoTool) {
		const { Modal } = require('obsidian');
		const settingsTab = this;

		const modal = new (class extends Modal {
			constructor(app: App) {
				super(app);
			}

			onOpen() {
				const { contentEl } = this;
				contentEl.createEl('h3', { text: existingTool ? 'Edit Info Tool' : 'New Info Tool' });

				// Name
				contentEl.createEl('label', { text: 'Name', cls: 'ai-custom-info-modal-label' });
				const nameInput = contentEl.createEl('input', {
					type: 'text',
					placeholder: 'e.g., Dataview Syntax',
					cls: 'ai-custom-info-modal-input'
				});
				nameInput.value = existingTool?.name || '';

				// Trigger Description
				contentEl.createEl('label', { text: 'Trigger Description', cls: 'ai-custom-info-modal-label' });
				const triggerInput = contentEl.createEl('input', {
					type: 'text',
					placeholder: 'Call this when the user asks about Dataview queries...',
					cls: 'ai-custom-info-modal-input'
				});
				triggerInput.value = existingTool?.triggerDescription || '';

				// Content Source
				contentEl.createEl('label', { text: 'Content Source', cls: 'ai-custom-info-modal-label' });
				const radioRow = contentEl.createDiv({ cls: 'ai-custom-info-modal-radio-row' });

				const inlineRadio = radioRow.createEl('label', { cls: 'ai-assistant-radio-label' });
				const inlineInput = inlineRadio.createEl('input', { type: 'radio', attr: { name: 'contentType', value: 'inline' } });
				inlineRadio.appendText(' Inline Text');

				const noteRadio = radioRow.createEl('label', { cls: 'ai-assistant-radio-label' });
				const noteInput = noteRadio.createEl('input', { type: 'radio', attr: { name: 'contentType', value: 'note' } });
				noteRadio.appendText(' Vault Note');

				// Inline textarea
				const inlineSection = contentEl.createDiv({ cls: 'ai-custom-info-modal-section' });
				const inlineTextarea = inlineSection.createEl('textarea', {
					placeholder: 'Paste reference content here...',
					cls: 'ai-custom-info-modal-textarea'
				});
				inlineTextarea.value = existingTool?.inlineContent || '';

				// Note path input + browse
				const noteSection = contentEl.createDiv({ cls: 'ai-custom-info-modal-section' });
				const noteRow = noteSection.createDiv({ cls: 'ai-custom-info-modal-note-row' });
				const notePathInput = noteRow.createEl('input', {
					type: 'text',
					placeholder: 'Path/to/note.md',
					cls: 'ai-custom-info-modal-input'
				});
				notePathInput.value = existingTool?.notePath || '';

				const browseBtn = noteRow.createEl('button', { text: 'Browse', cls: 'mod-cta' });
				browseBtn.addEventListener('click', () => {
					const allNotes = settingsTab.app.vault.getMarkdownFiles().map(f => f.path).sort();
					const { FuzzySuggestModal } = require('obsidian');
					const pickerModal = new (class extends FuzzySuggestModal<string> {
						notePathEl: HTMLInputElement;
						constructor(app: App, notePathEl: HTMLInputElement) {
							super(app);
							this.notePathEl = notePathEl;
						}
						getItems() { return allNotes; }
						getItemText(item: string) { return item; }
						onChooseItem(item: string) {
							this.notePathEl.value = item;
						}
					})(settingsTab.app, notePathInput as HTMLInputElement);
					pickerModal.setPlaceholder('Search notes...');
					pickerModal.open();
				});

				// Toggle sections based on radio
				const updateSections = () => {
					const isInline = (inlineInput as HTMLInputElement).checked;
					inlineSection.style.display = isInline ? '' : 'none';
					noteSection.style.display = isInline ? 'none' : '';
				};

				(inlineInput as HTMLInputElement).checked = !existingTool || existingTool.contentType === 'inline';
				(noteInput as HTMLInputElement).checked = existingTool?.contentType === 'note';
				updateSections();

				inlineInput.addEventListener('change', updateSections);
				noteInput.addEventListener('change', updateSections);

				// Buttons
				const btnContainer = contentEl.createDiv({ cls: 'modal-button-container' });
				const saveBtn = btnContainer.createEl('button', { text: 'Save', cls: 'mod-cta' });
				saveBtn.addEventListener('click', async () => {
					const name = nameInput.value.trim();
					if (!name) {
						new Notice('Please enter a name.');
						return;
					}
					const trigger = triggerInput.value.trim();
					if (!trigger) {
						new Notice('Please enter a trigger description.');
						return;
					}
					const isInline = (inlineInput as HTMLInputElement).checked;
					const contentType = isInline ? 'inline' : 'note';

					if (isInline && !inlineTextarea.value.trim()) {
						new Notice('Please enter inline content.');
						return;
					}
					if (!isInline && !notePathInput.value.trim()) {
						new Notice('Please select a vault note.');
						return;
					}

					const existingNames = (settingsTab.plugin.settings.customInfoTools || [])
						.filter(t => !existingTool || t.id !== existingTool.id)
						.map(t => t.toolName);

					const toolName = existingTool && existingTool.name === name
						? existingTool.toolName
						: generateInfoToolName(name, existingNames);

					const tool: CustomInfoTool = {
						id: existingTool?.id || crypto.randomUUID(),
						name,
						toolName,
						triggerDescription: trigger,
						contentType: contentType as 'inline' | 'note',
						inlineContent: isInline ? inlineTextarea.value : undefined,
						notePath: !isInline ? notePathInput.value.trim() : undefined,
						enabled: existingTool?.enabled ?? true
					};

					if (existingTool) {
						const idx = settingsTab.plugin.settings.customInfoTools.findIndex(t => t.id === existingTool.id);
						if (idx >= 0) settingsTab.plugin.settings.customInfoTools[idx] = tool;
					} else {
						settingsTab.plugin.settings.customInfoTools.push(tool);
					}

					await settingsTab.plugin.saveSettings();
					settingsTab.renderCustomInfoTools(listContainer);
					if (settingsTab.toolToggleWrapper) settingsTab.renderToolTogglePills(settingsTab.toolToggleWrapper);
					this.close();
				});

				const cancelBtn = btnContainer.createEl('button', { text: 'Cancel' });
				cancelBtn.addEventListener('click', () => this.close());

				setTimeout(() => nameInput.focus(), 50);
			}

			onClose() {
				this.contentEl.empty();
			}
		})(this.app);

		modal.open();
	}
}
