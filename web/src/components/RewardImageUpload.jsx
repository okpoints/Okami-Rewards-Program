import { useState } from 'react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';

const MAX_BYTES = 5 * 1024 * 1024;

export default function RewardImageUpload({ onUploaded }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleFile(file) {
    if (!file) return;
    setError('');
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('Image must be under 5MB.');
      return;
    }
    setBusy(true);
    try {
      const path = `rewards/${crypto.randomUUID()}-${file.name}`;
      const fileRef = ref(storage, path);
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);
      onUploaded(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <label className="btn btn-outline" style={{ cursor: 'pointer', margin: 0 }}>
        📁 Upload photo
        <input
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          disabled={busy}
          onChange={(e) => { handleFile(e.target.files[0]); e.target.value = ''; }}
        />
      </label>
      <label className="btn btn-outline" style={{ cursor: 'pointer', margin: 0 }}>
        📷 Take photo
        <input
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          disabled={busy}
          onChange={(e) => { handleFile(e.target.files[0]); e.target.value = ''; }}
        />
      </label>
      {busy && <span className="muted">Uploading...</span>}
      {error && <span className="error-text">{error}</span>}
    </div>
  );
}
