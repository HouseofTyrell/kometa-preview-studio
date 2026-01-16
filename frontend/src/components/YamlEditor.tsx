/**
 * YAML Editor Component
 *
 * A code editor for viewing and editing Kometa YAML configurations.
 * Features:
 * - Syntax-aware textarea with line numbers
 * - YAML validation with error highlighting
 * - Copy/download functionality
 * - Dark/light theme support via CSS variables
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import './YamlEditor.css';

interface YamlEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  height?: string;
  placeholder?: string;
  error?: string | null;
  onValidate?: (isValid: boolean, error: string | null) => void;
}

interface ValidationResult {
  isValid: boolean;
  error: string | null;
  errorLine: number | null;
}

/**
 * Basic YAML validation
 * Checks for common syntax errors without a full parser
 */
function validateYaml(yaml: string): ValidationResult {
  const lines = yaml.split('\n');

  // Check for common YAML issues
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip empty lines and comments
    if (line.trim() === '' || line.trim().startsWith('#')) {
      continue;
    }

    // Check for tabs (YAML requires spaces)
    if (line.includes('\t')) {
      return {
        isValid: false,
        error: `Line ${lineNum}: Tab characters not allowed in YAML. Use spaces for indentation.`,
        errorLine: lineNum,
      };
    }

    // Check for inconsistent indentation
    const leadingSpaces = line.match(/^( *)/)?.[1].length || 0;
    if (leadingSpaces % 2 !== 0) {
      return {
        isValid: false,
        error: `Line ${lineNum}: Odd number of spaces in indentation. Use 2-space indentation.`,
        errorLine: lineNum,
      };
    }

    // Check for invalid key format (must have : after key)
    if (!line.trim().startsWith('-') &&
        !line.trim().startsWith('#') &&
        line.includes(':') === false &&
        line.trim() !== '') {
      // Could be a continuation, check if previous non-empty line ends with |, >, or [
      let prevLineContent = '';
      for (let j = i - 1; j >= 0; j--) {
        const prevLine = lines[j].trim();
        if (prevLine !== '' && !prevLine.startsWith('#')) {
          prevLineContent = prevLine;
          break;
        }
      }
      const isMultiline = prevLineContent.endsWith('|') ||
                          prevLineContent.endsWith('>') ||
                          prevLineContent.endsWith('[') ||
                          prevLineContent.endsWith('{');

      if (!isMultiline && !line.trim().startsWith('-')) {
        // This might still be valid YAML, so just warn
      }
    }
  }

  return {
    isValid: true,
    error: null,
    errorLine: null,
  };
}

export function YamlEditor({
  value,
  onChange,
  readOnly = false,
  height = '400px',
  placeholder = '# Enter YAML configuration here...',
  error: externalError,
  onValidate,
}: YamlEditorProps) {
  const [internalError, setInternalError] = useState<string | null>(null);
  const [errorLine, setErrorLine] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  // Calculate line count for line numbers
  const lineCount = value.split('\n').length;
  const lines = Array.from({ length: Math.max(lineCount, 10) }, (_, i) => i + 1);

  // Validate on change
  useEffect(() => {
    if (value) {
      const result = validateYaml(value);
      setInternalError(result.error);
      setErrorLine(result.errorLine);
      onValidate?.(result.isValid, result.error);
    } else {
      setInternalError(null);
      setErrorLine(null);
      onValidate?.(true, null);
    }
  }, [value, onValidate]);

  // Sync scroll between textarea and line numbers
  const handleScroll = useCallback(() => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  // Handle text change
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange?.(e.target.value);
    },
    [onChange]
  );

  // Copy to clipboard
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [value]);

  // Download as file
  const handleDownload = useCallback(() => {
    const blob = new Blob([value], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kometa-config.yml';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [value]);

  // Handle tab key for indentation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (readOnly) return;

      if (e.key === 'Tab') {
        e.preventDefault();
        const target = e.currentTarget;
        const start = target.selectionStart;
        const end = target.selectionEnd;

        // Insert 2 spaces for tab
        const newValue = value.substring(0, start) + '  ' + value.substring(end);
        onChange?.(newValue);

        // Move cursor after the inserted spaces
        setTimeout(() => {
          target.selectionStart = target.selectionEnd = start + 2;
        }, 0);
      }
    },
    [value, onChange, readOnly]
  );

  const displayError = externalError || internalError;

  return (
    <div className="yaml-editor">
      <div className="yaml-editor-toolbar">
        <div className="yaml-editor-status">
          {displayError ? (
            <span className="yaml-editor-error">{displayError}</span>
          ) : value ? (
            <span className="yaml-editor-valid">Valid YAML</span>
          ) : (
            <span className="yaml-editor-empty">Empty</span>
          )}
        </div>
        <div className="yaml-editor-actions">
          <button
            type="button"
            onClick={handleCopy}
            className="yaml-editor-btn"
            title="Copy to clipboard"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="yaml-editor-btn"
            title="Download as .yml file"
            disabled={!value}
          >
            Download
          </button>
        </div>
      </div>

      <div className="yaml-editor-container" style={{ height }}>
        <div
          ref={lineNumbersRef}
          className="yaml-editor-line-numbers"
        >
          {lines.map((num) => (
            <div
              key={num}
              className={`yaml-editor-line-number ${errorLine === num ? 'error' : ''}`}
            >
              {num}
            </div>
          ))}
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          readOnly={readOnly}
          placeholder={placeholder}
          className={`yaml-editor-textarea ${displayError ? 'has-error' : ''}`}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </div>
    </div>
  );
}

export default YamlEditor;
