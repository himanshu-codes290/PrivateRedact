import { useState } from 'react';
import UploadDocument from '@/features/redact/components/UploadDocument';
import { RedactWorkspace } from '@/features/redact/components/RedactWorkspace';
import type { QueuedFile } from '@/features/redact/lib/fileIntake';

/**
 * /redact — owns the file queue and switches between choosing files and
 * the workspace. "Start over" bumps `session`, which remounts the workspace
 * so every worker, Blob URL and PDF.js resource is released.
 */
export default function Redact() {
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);

  const startOver = () => {
    setFiles([]);
    setOpen(false);
    setSession((s) => s + 1);
  };

  if (!open || files.length === 0) {
    return (
      <UploadDocument
        key={session}
        initialFiles={files}
        onProceed={(chosen) => {
          setFiles(chosen);
          setOpen(true);
        }}
      />
    );
  }

  return (
    <RedactWorkspace key={session} files={files} onFilesChange={setFiles} onStartOver={startOver} />
  );
}
