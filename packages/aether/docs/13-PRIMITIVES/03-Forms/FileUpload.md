### FileUpload

File upload component with drag & drop support, file validation, and preview capabilities.

#### Features

- Drag and drop file upload
- Click to browse file selection
- Multiple file upload support
- File type restrictions (accept attribute)
- File size validation
- File count limits
- Image preview support
- Upload progress tracking
- Controlled and uncontrolled modes

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { FileUpload } from 'aether/primitives';

const Example = defineComponent(() => {
  const files = signal<File[]>([]);

  const handleFilesAdded = (newFiles: File[]) => {
    console.log('Files added:', newFiles);
  };

  const handleFilesRejected = (rejections: FileRejection[]) => {
    console.error('Files rejected:', rejections);
  };

  return () => (
    <FileUpload
      value={files()}
      onValueChange={files}
      accept="image/*"
      multiple
      maxSize={5 * 1024 * 1024} // 5MB
      maxFiles={3}
      onFilesAdded={handleFilesAdded}
      onFilesRejected={handleFilesRejected}
    >
      <FileUpload.Dropzone class="dropzone">
        <div class="dropzone-content">
          <p>Drag and drop files here, or click to browse</p>
          <FileUpload.Trigger class="browse-button">
            Browse Files
          </FileUpload.Trigger>
        </div>
      </FileUpload.Dropzone>

      <div class="file-list">
        {files().map(file => (
          <FileUpload.Item key={file.name} file={file}>
            <span>{file.name}</span>
            <span>{(file.size / 1024).toFixed(2)} KB</span>
            <FileUpload.ItemRemove file={file}>
              Remove
            </FileUpload.ItemRemove>
          </FileUpload.Item>
        ))}
      </div>
    </FileUpload>
  );
});
```

#### With Image Previews

```typescript
const Example = defineComponent(() => {
  return () => (
    <FileUpload accept="image/*" multiple>
      <FileUpload.Dropzone>
        Drop images here
      </FileUpload.Dropzone>

      <div class="preview-grid">
        {files().map(file => (
          <FileUpload.Item key={file.name} file={file}>
            {file.preview && (
              <img src={file.preview} alt={file.name} />
            )}
            <FileUpload.ItemRemove file={file} />
          </FileUpload.Item>
        ))}
      </div>
    </FileUpload>
  );
});
```

#### API

**`<FileUpload>`** - Root component
- `value?: File[]` - Controlled files value
- `onValueChange?: (files: File[]) => void` - Value change callback
- `defaultValue?: File[]` - Default value (uncontrolled)
- `accept?: string` - Accepted file types (e.g., "image/*", ".pdf,.doc")
- `multiple?: boolean` - Allow multiple files (default: false)
- `maxSize?: number` - Maximum file size in bytes
- `maxFiles?: number` - Maximum number of files
- `disabled?: boolean` - Whether upload is disabled
- `onFilesAdded?: (files: File[]) => void` - Called when files added
- `onFilesRejected?: (rejections: FileRejection[]) => void` - Called when files rejected
- `validator?: (file: File) => string | null` - Custom file validator

**`<FileUpload.Trigger>`** - Button to open file browser

**`<FileUpload.Dropzone>`** - Drag and drop zone (also opens file browser on click)

**`<FileUpload.Item>`** - File item display
- `file: File` - File to display

**`<FileUpload.ItemRemove>`** - Button to remove a file
- `file: File` - File to remove

---

