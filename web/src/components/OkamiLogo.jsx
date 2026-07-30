export default function OkamiLogo({ size = 32 }) {
  return (
    <div className="logo" style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6}>
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="12" cy="12" r="3.2" fill="currentColor" />
      </svg>
    </div>
  );
}
