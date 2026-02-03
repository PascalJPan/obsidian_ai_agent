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
		// Check if parent folder matches
		const parentPath = filePath.substring(0, filePath.lastIndexOf('/'));
		if (parentPath === folder) {
			return true;
		}
	}
	return false;
}
