/**
 * FileTree Component
 *
 * Hierarchical file tree using Aether's TreeView component.
 * Features:
 * - Virtual scrolling for large file lists
 * - Expand/collapse folders
 * - File selection
 * - File type icons
 * - Right-click context menu
 * - Search/filter capability
 */

import { defineComponent, signal, computed, onMount } from '@omnitron-dev/aether';
import { Show } from '@omnitron-dev/aether/control-flow';
import { inject } from '@omnitron-dev/aether/di';
import { TreeView, type TreeNodeData } from '@omnitron-dev/aether/data';
import { FileService } from '../services/file.service';

export interface FileNode {
  id: string;
  name: string;
  type: 'file' | 'folder';
  path: string;
  language?: string;
  children?: FileNode[];
}

export interface FileTreeProps {
  onFileSelect?: (fileId: string) => void;
  onFileCreate?: (parentPath?: string) => void;
  onFileRename?: (fileId: string) => void;
  onFileDelete?: (fileId: string) => void;
}

/**
 * Get file icon based on file extension or type
 */
function getFileIcon(node: FileNode): string {
  if (node.type === 'folder') {
    return '📁';
  }

  const ext = node.name.split('.').pop()?.toLowerCase();

  const iconMap: Record<string, string> = {
    // TypeScript/JavaScript
    'ts': '🔷',
    'tsx': '⚛️',
    'js': '🟨',
    'jsx': '⚛️',
    'mjs': '🟨',
    'cjs': '🟨',

    // Web
    'html': '🌐',
    'css': '🎨',
    'scss': '🎨',
    'sass': '🎨',
    'less': '🎨',

    // Config
    'json': '📋',
    'yaml': '📋',
    'yml': '📋',
    'toml': '📋',
    'xml': '📋',

    // Markdown/Docs
    'md': '📝',
    'mdx': '📝',
    'txt': '📄',

    // Images
    'png': '🖼️',
    'jpg': '🖼️',
    'jpeg': '🖼️',
    'gif': '🖼️',
    'svg': '🖼️',
    'webp': '🖼️',

    // Other
    'sh': '⚙️',
    'bash': '⚙️',
    'py': '🐍',
    'rs': '🦀',
    'go': '🐹',
    'java': '☕',
    'cpp': '⚙️',
    'c': '⚙️',
  };

  return iconMap[ext || ''] || '📄';
}

/**
 * Convert FileNode tree to TreeNodeData for TreeView
 */
function convertToTreeNodeData(nodes: FileNode[]): TreeNodeData[] {
  return nodes.map(node => ({
    id: node.id,
    label: node.name,
    data: node,
    children: node.children ? convertToTreeNodeData(node.children) : undefined,
  }));
}

/**
 * FileTree - Hierarchical file tree component
 */
export const FileTree = defineComponent<FileTreeProps>((props) => {
  const fileService = inject(FileService);

  const searchTerm = signal('');
  const expandedKeys = signal<string[]>(['root']);
  const selectedKeys = signal<string[]>([]);
  const contextMenuVisible = signal(false);
  const contextMenuPosition = signal({ x: 0, y: 0 });
  const contextMenuNode = signal<FileNode | null>(null);

  // Get file tree from service
  const fileTree = computed(() => {
    return fileService.getFileTree();
  });

  // Convert to TreeNodeData
  const treeData = computed(() => {
    return convertToTreeNodeData(fileTree());
  });

  // Handle file selection
  const handleSelect = (keys: string[]) => {
    selectedKeys.set(keys);

    if (keys.length > 0) {
      const nodeId = keys[0];
      const allNodes = flattenFileTree(fileTree());
      const node = allNodes.find(n => n.id === nodeId);

      if (node && node.type === 'file') {
        props.onFileSelect?.(nodeId);
      }
    }
  };

  // Handle folder expansion
  const handleExpand = (keys: string[]) => {
    expandedKeys.set(keys);
  };

  // Handle search
  const handleSearch = (e: Event) => {
    const target = e.target as HTMLInputElement;
    searchTerm.set(target.value);
  };

  // Clear search
  const clearSearch = () => {
    searchTerm.set('');
  };

  // Handle right-click context menu
  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();

    const target = e.target as HTMLElement;
    const nodeElement = target.closest('[data-node-id]') as HTMLElement;

    if (nodeElement) {
      const nodeId = nodeElement.getAttribute('data-node-id');
      if (nodeId) {
        const allNodes = flattenFileTree(fileTree());
        const node = allNodes.find(n => n.id === nodeId);

        if (node) {
          contextMenuNode.set(node);
          contextMenuPosition.set({ x: e.clientX, y: e.clientY });
          contextMenuVisible.set(true);
        }
      }
    }
  };

  // Close context menu
  const closeContextMenu = () => {
    contextMenuVisible.set(false);
    contextMenuNode.set(null);
  };

  // Context menu actions
  const handleCreateFile = () => {
    const node = contextMenuNode();
    if (node) {
      const parentPath = node.type === 'folder' ? node.path : node.path.split('/').slice(0, -1).join('/');
      props.onFileCreate?.(parentPath);
    }
    closeContextMenu();
  };

  const handleRename = () => {
    const node = contextMenuNode();
    if (node) {
      props.onFileRename?.(node.id);
    }
    closeContextMenu();
  };

  const handleDelete = () => {
    const node = contextMenuNode();
    if (node) {
      props.onFileDelete?.(node.id);
    }
    closeContextMenu();
  };

  // Custom node renderer with icons
  const renderNode = (node: TreeNodeData, context: any) => {
    const fileNode = node.data as FileNode;
    const icon = getFileIcon(fileNode);
    const isExpanded = context.isExpanded;
    const isSelected = context.isSelected;

    return (
      <div
        class="file-tree-node"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          width: '100%',
        }}
      >
        <Show when={() => fileNode.type === 'folder'}>
          <span class="folder-icon">{() => isExpanded ? '📂' : '📁'}</span>
        </Show>
        <Show when={() => fileNode.type === 'file'}>
          <span class="file-icon">{icon}</span>
        </Show>
        <span class="file-name" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.label}
        </span>
      </div>
    );
  };

  // Close context menu on click outside
  onMount(() => {
    const handleClickOutside = () => {
      if (contextMenuVisible()) {
        closeContextMenu();
      }
    };

    document.addEventListener('click', handleClickOutside);

    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  });

  return () => (
    <div class="file-tree-container" onContextMenu={handleContextMenu}>
      {/* Search bar */}
      <div class="file-tree-search">
        <input
          type="text"
          placeholder="Search files..."
          value={searchTerm()}
          onInput={handleSearch}
          class="search-input"
        />
        <Show when={() => searchTerm()}>
          <button
            class="clear-search-button"
            onClick={clearSearch}
            title="Clear search"
          >
            ×
          </button>
        </Show>
      </div>

      {/* Tree view */}
      <div class="file-tree-content">
        <Show
          when={() => treeData().length > 0}
          fallback={
            <div class="empty-tree">
              <p>No files yet</p>
              <button
                class="primary-button"
                onClick={() => props.onFileCreate?.()}
              >
                Create File
              </button>
            </div>
          }
        >
          <TreeView
            data={treeData()}
            height="100%"
            itemHeight={32}
            expandedKeys={expandedKeys()}
            selectedKeys={selectedKeys()}
            onExpand={handleExpand}
            onSelect={handleSelect}
            searchTerm={searchTerm()}
            renderNode={renderNode}
            variant="default"
            size="md"
          />
        </Show>
      </div>

      {/* Context menu */}
      <Show when={() => contextMenuVisible()}>
        <div
          class="context-menu"
          style={{
            position: 'fixed',
            left: `${contextMenuPosition().x}px`,
            top: `${contextMenuPosition().y}px`,
            backgroundColor: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '0.375rem',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            padding: '0.25rem',
            zIndex: 1000,
            minWidth: '160px',
          }}
          onClick={(e: Event) => e.stopPropagation()}
        >
          <button
            class="context-menu-item"
            onClick={handleCreateFile}
          >
            ➕ New File
          </button>
          <button
            class="context-menu-item"
            onClick={handleRename}
          >
            ✏️ Rename
          </button>
          <button
            class="context-menu-item danger"
            onClick={handleDelete}
          >
            🗑️ Delete
          </button>
        </div>
      </Show>
    </div>
  );
});

/**
 * Helper function to flatten file tree for searching
 */
function flattenFileTree(nodes: FileNode[]): FileNode[] {
  const result: FileNode[] = [];

  for (const node of nodes) {
    result.push(node);
    if (node.children) {
      result.push(...flattenFileTree(node.children));
    }
  }

  return result;
}
