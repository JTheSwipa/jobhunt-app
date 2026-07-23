import { useEffect, useMemo, useState } from "react";
import { api, type CvProfile, type MasterCv, type TailoringSuggestion, type ToggleNode } from "../lib/api";

export default function CvEditor() {
  const [master, setMaster] = useState<MasterCv | null>(null);
  const [masterMissing, setMasterMissing] = useState(false);
  const [toggles, setToggles] = useState<ToggleNode[]>([]);
  const [profiles, setProfiles] = useState<CvProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const [newProfileName, setNewProfileName] = useState("");
  const [renderMsg, setRenderMsg] = useState<string | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [targetRole, setTargetRole] = useState("");
  const [suggestions, setSuggestions] = useState<TailoringSuggestion[] | null>(null);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  async function loadMaster() {
    try {
      const m = await api.cv.getMaster("master");
      setMaster(m);
      setMasterMissing(false);
      setToggles(await api.cv.toggles(m.id));
      setProfiles(await api.cv.listProfiles(m.id));
    } catch {
      setMasterMissing(true);
    }
  }

  useEffect(() => {
    loadMaster();
  }, []);

  const selectedProfile = profiles.find((p) => p.id === selectedId) ?? null;

  useEffect(() => {
    setVisibility(selectedProfile?.visibility ?? {});
  }, [selectedProfile]);

  const grouped = useMemo(() => {
    const bySection = new Map<string, { label: string; section: ToggleNode; items: ToggleNode[] }>();
    for (const node of toggles) {
      if (node.kind === "section") {
        bySection.set(node.sectionKey, { label: node.sectionLabel, section: node, items: [] });
      }
    }
    for (const node of toggles) {
      if (node.kind === "item") {
        const group = bySection.get(node.sectionKey);
        if (group) group.items.push(node);
      }
    }
    return Array.from(bySection.values());
  }, [toggles]);

  function effectiveHidden(node: ToggleNode): boolean {
    return visibility[node.key] ?? node.hidden;
  }

  function toggle(node: ToggleNode) {
    setVisibility((v) => ({ ...v, [node.key]: !effectiveHidden(node) }));
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const data = JSON.parse(text);
    await api.cv.saveMaster("master", data);
    await loadMaster();
  }

  async function createProfile() {
    if (!master || !newProfileName.trim()) return;
    const profile = await api.cv.createProfile({
      masterCvId: master.id,
      name: newProfileName.trim(),
      visibility: {},
      order: ["profile", "skills", "experience", "projects", "education", "certifications", "languages", "awards", "academic_training", "conferences", "interests"],
      style: "default",
    });
    setNewProfileName("");
    setProfiles(await api.cv.listProfiles(master.id));
    setSelectedId(profile.id);
  }

  async function saveVisibility() {
    if (!selectedProfile) return;
    await api.cv.updateProfile(selectedProfile.id, { visibility });
    if (master) setProfiles(await api.cv.listProfiles(master.id));
    setPreviewNonce((n) => n + 1);
  }

  async function renderPdf() {
    if (!selectedProfile) return;
    setRenderMsg("Rendering…");
    try {
      const result = await api.cv.render(selectedProfile.id);
      setRenderMsg(`Rendered: ${result.pdfPath}`);
    } catch (err) {
      setRenderMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function runSuggest() {
    if (!selectedProfile || !targetRole.trim()) return;
    setSuggesting(true);
    setSuggestError(null);
    setSuggestions(null);
    try {
      const result = await api.cv.suggest(selectedProfile.id, targetRole.trim());
      setSuggestions(result);
      setAccepted(Object.fromEntries(result.map((s) => [s.key, true])));
    } catch (err) {
      setSuggestError(err instanceof Error ? err.message : String(err));
    } finally {
      setSuggesting(false);
    }
  }

  // Suggestions never write to the profile directly — accepting them only
  // pre-fills the same local `visibility` state the manual checkboxes use,
  // so the user still reviews everything (and can hand-adjust) before the
  // existing "Save toggles" button persists anything. Nothing here bypasses
  // that human-in-the-loop step.
  function applyAcceptedSuggestions() {
    if (!suggestions) return;
    setVisibility((v) => {
      const next = { ...v };
      for (const s of suggestions) {
        if (accepted[s.key]) next[s.key] = s.suggestedHidden;
      }
      return next;
    });
    setSuggestions(null);
  }

  if (masterMissing) {
    return (
      <section>
        <h2>CV Editor</h2>
        <div className="panel">
          <p>No master CV yet. Upload an rxresume-style CV JSON export to get started.</p>
          <input type="file" accept="application/json" onChange={handleUpload} />
        </div>
      </section>
    );
  }

  if (!master) return <p>Loading…</p>;

  return (
    <section>
      <h2>CV Editor</h2>

      <div className="panel row">
        <label>
          Profile:{" "}
          <select value={selectedId ?? ""} onChange={(e) => setSelectedId(e.target.value || null)}>
            <option value="">— select a sector profile —</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <input placeholder="New profile name (e.g. Corporate)" value={newProfileName} onChange={(e) => setNewProfileName(e.target.value)} />
        <button type="button" onClick={createProfile}>
          Create profile
        </button>
      </div>

      {selectedProfile ? (
        <>
          <div className="panel">
            <div className="row">
              <input
                placeholder="Target role, e.g. 'ML internship at an early-stage startup'"
                value={targetRole}
                onChange={(e) => setTargetRole(e.target.value)}
                style={{ minWidth: 340 }}
              />
              <button type="button" onClick={runSuggest} disabled={suggesting || !targetRole.trim()}>
                {suggesting ? "Asking local model… (can take ~1 min)" : "Suggest with AI (local, via Ollama)"}
              </button>
            </div>
            {suggestError && <p style={{ color: "#dc2626" }}>{suggestError}</p>}

            {suggestions && (
              <div style={{ marginTop: 12 }}>
                <p>Suggestions are not applied yet — review, then apply the ones you accept:</p>
                {suggestions.map((s) => (
                  <div key={s.key} className="toggle-row">
                    <input
                      type="checkbox"
                      checked={accepted[s.key] ?? false}
                      onChange={() => setAccepted((a) => ({ ...a, [s.key]: !a[s.key] }))}
                    />
                    <span>
                      <strong>{s.label}</strong> → {s.suggestedHidden ? "hide" : "show"}{" "}
                      <span style={{ color: "var(--muted)" }}>({s.reason})</span>
                    </span>
                  </div>
                ))}
                <div className="row" style={{ marginTop: 8 }}>
                  <button type="button" onClick={applyAcceptedSuggestions}>
                    Apply accepted suggestions to toggles
                  </button>
                  <button type="button" onClick={() => setSuggestions(null)}>
                    Discard
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="panel">
            {grouped.map((group) => {
              const sectionHidden = effectiveHidden(group.section);
              return (
                <div key={group.section.key}>
                  <div className="toggle-row">
                    <input type="checkbox" checked={!sectionHidden} onChange={() => toggle(group.section)} />
                    <span className="section-label">{group.label}</span>
                  </div>
                  {!sectionHidden &&
                    group.items.map((item) => (
                      <div key={item.key} className="toggle-row item">
                        <input type="checkbox" checked={!effectiveHidden(item)} onChange={() => toggle(item)} />
                        <span>{item.itemLabel}</span>
                      </div>
                    ))}
                </div>
              );
            })}
          </div>

          <div className="panel row">
            <button type="button" onClick={saveVisibility}>
              Save toggles
            </button>
            <button type="button" onClick={renderPdf}>
              Render PDF
            </button>
            {renderMsg && <span>{renderMsg}</span>}
          </div>

          <iframe
            key={previewNonce}
            title="CV preview"
            src={api.cv.previewUrl(selectedProfile.id)}
            style={{ width: "100%", height: "600px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff" }}
          />
        </>
      ) : (
        <p>Select or create a sector profile to start toggling sections/items.</p>
      )}
    </section>
  );
}
