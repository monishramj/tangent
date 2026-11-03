import { useEffect, useState } from "react";
import SplitText from "@/components/SplitText";
import Stage from "./Stage";
import { ping } from "./ipc";

export default function App() {
  const [sidecar, setSidecar] = useState("...");
  useEffect(() => {
    ping().then(setSidecar, (e) => setSidecar(`error: ${e}`));
  }, []);

  return (
    <main className="flex h-screen flex-col gap-4 bg-ink p-6">
      <SplitText tag="h1" text="Tangent" className="text-5xl text-brass" splitType="chars" trigger="load" />
      <p className="text-sm text-parchment/70">sidecar: {sidecar}</p>
      <Stage />
    </main>
  );
}
