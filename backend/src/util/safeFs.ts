import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Safely resolve a path within a base directory, preventing traversal attacks
 */
export function safeResolve(basePath: string, requestedPath: string): string | null {
  const resolved = path.resolve(basePath, requestedPath);
  const normalizedBase = path.resolve(basePath);

  if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
    return null;
  }

  return resolved;
}

/**
 * Check if a path exists
 */
export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a directory exists, creating it if necessary
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Read JSON file safely
 */
export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Write JSON file
 */
export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Read text file safely
 */
export async function readText(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Write text file
 */
export async function writeText(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content, 'utf-8');
}

/**
 * Copy file
 */
export async function copyFile(src: string, dest: string): Promise<void> {
  await fs.copyFile(src, dest);
}

/**
 * List files in directory
 */
export async function listFiles(dirPath: string): Promise<string[]> {
  try {
    return await fs.readdir(dirPath);
  } catch {
    return [];
  }
}

/**
 * Get file stats safely
 */
export async function getStats(filePath: string): Promise<fs.FileHandle | null> {
  try {
    const stats = await fs.stat(filePath);
    return stats as unknown as fs.FileHandle;
  } catch {
    return null;
  }
}

/**
 * Delete file safely
 */
export async function deleteFile(filePath: string): Promise<boolean> {
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete directory recursively
 */
export async function deleteDir(dirPath: string): Promise<boolean> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
