/**
 * File utility functions for ObsidianAgent
 */

/**
 * Check if a file is in an excluded folder
 */
export function isFileExcluded(filePath: string, excludedFolders: string[]): boolean {
	if (excludedFolders.length === 0) return false;
	for (const folder of excludedFolders) {
		const normalizedFolder = folder.endsWith('/') ? folder : folder + '/';
		if (filePath.startsWith(normalizedFolder)) {
			return true;
		}
	}
	return false;
}

/**
 * Check if a folder itself is excluded (or is inside an excluded folder)
 */
export function isFolderExcluded(folderPath: string, excludedFolders: string[]): boolean {
	if (excludedFolders.length === 0) return false;
	for (const excluded of excludedFolders) {
		const normalizedExcluded = excluded.endsWith('/') ? excluded.slice(0, -1) : excluded;
		const normalizedFolder = folderPath.endsWith('/') ? folderPath.slice(0, -1) : folderPath;
		// Exact match or the folder is nested inside an excluded folder
		if (normalizedFolder === normalizedExcluded || normalizedFolder.startsWith(normalizedExcluded + '/')) {
			return true;
		}
	}
	return false;
}
