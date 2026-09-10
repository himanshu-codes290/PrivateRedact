import { useState } from 'react';
import DocumentUpload, {
  type UploadedFileItem,
} from '@/features/redact/components/UploadDocument';
import { RedactWorkspace } from '@/features/redact/components/RedactWorkspace';

/**
 * /redact — owns the uploaded file queue (lifted state) and switches
 * between the upload screen and the redaction workspace.
 */
export default function Redact() {
  const [files, setFiles] = useState<UploadedFileItem[]>([]);
  const [workspaceSession, setWorkspaceSession] = useState(0);

  // Return to upload step and drop any half-done workspace state.
  const handleReset = () => {
    setFiles([]);
    setWorkspaceSession((s) => s + 1);
  };

  if (files.length === 0) {
    return <DocumentUpload onProceedToRedact={setFiles} />;
  }

  return (
    <RedactWorkspace
      key={workspaceSession}
      files={files}
      onReset={handleReset}
    />
  );
}
