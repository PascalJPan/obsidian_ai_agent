/**
 * File utility functions for ObsidianAgent
 */

/**
 * Check if a file is in an excluded folder
 */
export function isFileExcluded(filePath: string, excludedFolders: string[]): boolean {
	for (const folder of excludedFolders) {
		const normalizedFolder = folder.endsWith('/') ? folder : folder + '/';
		if (filePath.startsWith(normalizedFolder)) {
			return true;
		}
	}
	return false;
}
