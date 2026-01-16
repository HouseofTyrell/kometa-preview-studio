import * as path from 'path';
import { getJobPaths } from './paths.js';
import { pathExists } from '../util/safeFs.js';
import { JobMeta } from './jobRepository.js';
import { ArtworkSource } from '../plex/fetchArtwork.js';

export interface JobArtifacts {
  jobId: string;
  items: Array<{
    id: string;
    title: string;
    type: string;
    beforeUrl: string;
    afterUrl: string;
    draftUrl?: string;
    baseSource: ArtworkSource;
    warnings: string[];
  }>;
}

/**
 * Manager for job artifacts (images, logs)
 * Handles retrieval of before/after images and log files
 */
export class ArtifactManager {
  // Supported image extensions (in priority order)
  private static readonly IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];

  /**
   * Get job artifacts (before/after images)
   */
  async getJobArtifacts(jobId: string, meta: JobMeta): Promise<JobArtifacts | null> {
    if (!meta) {
      return null;
    }

    const paths = getJobPaths(jobId);
    const items: JobArtifacts['items'] = [];

    for (const target of meta.targets) {
      const beforeFile = `${target.id}.jpg`;
      const beforePath = path.join(paths.inputDir, beforeFile);

      // Find the after file with any supported extension
      let afterFile = '';
      let afterUrl = '';
      for (const ext of ArtifactManager.IMAGE_EXTENSIONS) {
        const candidateFile = `${target.id}_after.${ext}`;
        const candidatePath = path.join(paths.outputDir, candidateFile);
        if (await pathExists(candidatePath)) {
          afterFile = candidateFile;
          afterUrl = `/api/preview/image/${jobId}/output/${afterFile}`;
          break;
        }
      }

      // Find draft file (instant preview shown while Kometa renders)
      let draftUrl = '';
      const draftDir = path.join(paths.outputDir, 'draft');
      if (await pathExists(draftDir)) {
        for (const ext of ArtifactManager.IMAGE_EXTENSIONS) {
          const draftFile = `${target.id}_draft.${ext}`;
          const draftPath = path.join(draftDir, draftFile);
          if (await pathExists(draftPath)) {
            draftUrl = `/api/preview/image/${jobId}/output/draft/${draftFile}`;
            break;
          }
        }
      }

      if (await pathExists(beforePath)) {
        items.push({
          id: target.id,
          title: target.title,
          type: target.type,
          beforeUrl: `/api/preview/image/${jobId}/input/${beforeFile}`,
          afterUrl,
          draftUrl,
          baseSource: target.baseSource,
          warnings: target.warnings,
        });
      }
    }

    return { jobId, items };
  }

  /**
   * Get path to an image file
   * Returns null if path traversal is detected
   */
  getImagePath(jobId: string, folder: 'input' | 'output', filename: string): string | null {
    const paths = getJobPaths(jobId);
    const dir = folder === 'input' ? paths.inputDir : paths.outputDir;

    // Sanitize filename to prevent path traversal
    const sanitized = path.basename(filename);
    if (sanitized !== filename) {
      return null;
    }

    return path.join(dir, sanitized);
  }

  /**
   * Get path to log file
   */
  getLogPath(jobId: string): string {
    const paths = getJobPaths(jobId);
    return path.join(paths.logsDir, 'container.log');
  }
}
