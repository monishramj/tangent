import Select from "@/components/ui/Select";
import { providerLabels, providerNames, type ProviderName } from "@/llm/registry";

export default function ProviderSelect({ value, onChange, installations }: {
  value: ProviderName;
  onChange: (name: ProviderName) => void;
  installations?: ProviderName[];
}) {
  return <label className="tl-setting-row">
    <span>AI provider</span>
    <Select value={value} onChange={e => onChange(e.target.value as ProviderName)}>
      {providerNames.map(name => <option key={name} value={name} >
        {providerLabels[name]}{installations && (installations.includes(name) ? " · Installed" : " · Not installed")}{name === "agy" && " · Experimental"}
      </option>)}
    </Select>
  </label>;
}
