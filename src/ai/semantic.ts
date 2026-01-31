/**
 * Semantic search utilities for embedding-based note similarity
 */

import { requestUrl, Vault, TFolder } from 'obsidian';
import { EmbeddingChunk, EmbeddingIndex, EmbeddingModel } from '../types';

// Chunk interface for internal processing
interface Chunk {
	heading: string;
	content: string;
}

/**
 * Split note content into chunks by headings.
 * Content before first heading = chunk with heading=""
 * Notes with no headings = single chunk with heading=""
 * @internal Used only within reindexVault()
 */
function chunkByHeadings(content: string): Chunk[] {
	const chunks: Chunk[] = [];
	const headingRegex = /^(#{1,6})\s+(.+)$/gm;

	let lastIndex = 0;
	let lastHeading = '';
	let match: RegExpExecArray | null;

	const matches: { index: number; heading: string }[] = [];

	while ((match = headingRegex.exec(content)) !== null) {
		matches.push({
			index: match.index,
			heading: match[0]
		});
	}

	if (matches.length === 0) {
		// No headings - return entire content as single chunk
		const trimmed = content.trim();
		if (trimmed) {
			chunks.push({ heading: '', content: trimmed });
		}
		return chunks;
	}

	// Content before first heading (preamble)
	if (matches[0].index > 0) {
		const preamble = content.substring(0, matches[0].index).trim();
		if (preamble) {
			chunks.push({ heading: '', content: preamble });
		}
	}

	// Process each heading section
	for (let i = 0; i < matches.length; i++) {
		const currentMatch = matches[i];
		const nextMatch = matches[i + 1];

		const startIndex = currentMatch.index;
		const endIndex = nextMatch ? nextMatch.index : content.length;

		const sectionContent = content.substring(startIndex, endIndex).trim();
		if (sectionContent) {
			chunks.push({
				heading: currentMatch.heading,
				content: sectionContent
			});
		}
	}

	return chunks;
}

/**
 * Compute SHA-256 hash for chunk identification
 * @internal Used only within reindexVault()
 */
async function computeChunkHash(heading: string, content: string): Promise<string> {
	const text = heading + '\n' + content;
	const encoder = new TextEncoder();
	const data = encoder.encode(text);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate embedding for text using OpenAI API
 */
export async function generateEmbedding(
	text: string,
	apiKey: string,
	model: EmbeddingModel
): Promise<number[]> {
	// Truncate text if too long (max ~8191 tokens, roughly 32K chars for safety)
	const truncatedText = text.length > 30000 ? text.substring(0, 30000) : text;

	const response = await requestUrl({
		url: 'https://api.openai.com/v1/embeddings',
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			model: model,
			input: truncatedText,
		}),
	});

	const data = response.json;
	if (!data.data || !data.data[0] || !data.data[0].embedding) {
		throw new Error('Invalid embedding response from OpenAI');
	}

	return data.data[0].embedding;
}

/**
 * Compute cosine similarity between two vectors
 * @internal Used only within searchSemantic()
 */
function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) {
		throw new Error('Vectors must have the same length');
	}

	let dotProduct = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < a.length; i++) {
		dotProduct += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}

	normA = Math.sqrt(normA);
	normB = Math.sqrt(normB);

	if (normA === 0 || normB === 0) {
		return 0;
	}

	return dotProduct / (normA * normB);
}

/**
 * Check if a file is in an excluded folder
 */
function isFileExcludedByPath(filePath: string, excludedFolders: string[]): boolean {
	for (const folder of excludedFolders) {
		const normalizedFolder = folder.endsWith('/') ? folder : folder + '/';
		if (filePath.startsWith(normalizedFolder)) {
			return true;
		}
		// Check if parent folder matches
		const parentPath = filePath.substring(0, filePath.lastIndexOf('/'));
		if (parentPath === folder) {
			return true;
		}
	}
	return false;
}

/**
 * Reindex the entire vault, reusing existing embeddings where content hasn't changed
 */
export async function reindexVault(
	vault: Vault,
	excludedFolders: string[],
	existingIndex: EmbeddingIndex | null,
	apiKey: string,
	model: EmbeddingModel,
	onProgress?: (current: number, total: number, status: string) => void
): Promise<{ index: EmbeddingIndex; stats: { total: number; updated: number; reused: number } }> {
	const allFiles = vault.getMarkdownFiles();
	const eligibleFiles = allFiles.filter(f => !isFileExcludedByPath(f.path, excludedFolders));

	// Build hash map from existing index for quick lookup
	const existingChunks = new Map<string, EmbeddingChunk>();
	if (existingIndex && existingIndex.model === model) {
		for (const chunk of existingIndex.chunks) {
			existingChunks.set(chunk.hash, chunk);
		}
	}

	const newChunks: EmbeddingChunk[] = [];
	let updated = 0;
	let reused = 0;

	for (let i = 0; i < eligibleFiles.length; i++) {
		const file = eligibleFiles[i];
		onProgress?.(i + 1, eligibleFiles.length, `Processing ${file.name}...`);
		// Yield to event loop to allow UI repaint
		await new Promise(resolve => setTimeout(resolve, 0));

		const content = await vault.cachedRead(file);
		const chunks = chunkByHeadings(content);

		for (const chunk of chunks) {
			const hash = await computeChunkHash(chunk.heading, chunk.content);

			// Check if we can reuse existing embedding
			const existing = existingChunks.get(hash);
			if (existing && existing.notePath === file.path) {
				newChunks.push(existing);
				reused++;
				continue;
			}

			// Generate new embedding
			try {
				const embedding = await generateEmbedding(
					chunk.heading ? `${chunk.heading}\n\n${chunk.content}` : chunk.content,
					apiKey,
					model
				);

				newChunks.push({
					notePath: file.path,
					heading: chunk.heading,
					content: chunk.content,
					hash: hash,
					embedding: embedding
				});
				updated++;
			} catch (error) {
				console.error(`Failed to generate embedding for ${file.path}:`, error);
			}
		}
	}

	const newIndex: EmbeddingIndex = {
		model: model,
		lastUpdated: new Date().toISOString(),
		chunks: newChunks
	};

	return {
		index: newIndex,
		stats: {
			total: eligibleFiles.length,
			updated: updated,
			reused: reused
		}
	};
}

/**
 * Search for semantically similar notes
 * Returns top-K unique notes (deduplicated by path, keeping highest score)
 * @param minSimilarity Optional threshold (0-1) to filter out low-similarity results
 */
export function searchSemantic(
	queryEmbedding: number[],
	index: EmbeddingIndex,
	excludePaths: Set<string>,
	topK: number,
	minSimilarity?: number
): { notePath: string; score: number; heading: string }[] {
	// Calculate similarity for all non-excluded chunks
	const scores: { notePath: string; score: number; heading: string }[] = [];

	for (const chunk of index.chunks) {
		if (excludePaths.has(chunk.notePath)) {
			continue;
		}

		const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);

		// Filter by minimum similarity threshold if provided
		if (minSimilarity !== undefined && similarity < minSimilarity) {
			continue;
		}

		scores.push({
			notePath: chunk.notePath,
			score: similarity,
			heading: chunk.heading
		});
	}

	// Sort by score descending
	scores.sort((a, b) => b.score - a.score);

	// Deduplicate by notePath, keeping highest score
	const seenPaths = new Set<string>();
	const results: { notePath: string; score: number; heading: string }[] = [];

	for (const item of scores) {
		if (seenPaths.has(item.notePath)) {
			continue;
		}
		seenPaths.add(item.notePath);
		results.push(item);

		if (results.length >= topK) {
			break;
		}
	}

	return results;
}

/**
 * Load embedding index from plugin data folder
 * Uses vault.adapter for direct file access (works with .obsidian files)
 */
export async function loadEmbeddingIndex(
	vault: Vault,
	pluginDataPath: string
): Promise<EmbeddingIndex | null> {
	try {
		const indexPath = `${pluginDataPath}/embeddings.json`;
		// Use adapter for direct file access - vault.getAbstractFileByPath doesn't index .obsidian files
		const exists = await vault.adapter.exists(indexPath);
		if (!exists) {
			return null;
		}
		const content = await vault.adapter.read(indexPath);
		return JSON.parse(content) as EmbeddingIndex;
	} catch (error) {
		console.error('Failed to load embedding index:', error);
		return null;
	}
}

/**
 * Save embedding index to plugin data folder
 * Uses vault.adapter for direct file access (works with .obsidian files)
 */
export async function saveEmbeddingIndex(
	vault: Vault,
	pluginDataPath: string,
	index: EmbeddingIndex
): Promise<void> {
	const indexPath = `${pluginDataPath}/embeddings.json`;
	const content = JSON.stringify(index);
	// Use adapter.write which handles both create and update
	await vault.adapter.write(indexPath, content);
}
