export default function NegotiatorPage() {
  return (
    <div className="fixed inset-0 md:left-64 bottom-16 md:bottom-0 top-0">
      <iframe
        src="https://negociator.site"
        className="w-full h-full border-0"
        allow="camera; microphone; clipboard-read; clipboard-write"
        title="NegoApp"
      />
    </div>
  );
}
