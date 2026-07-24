import { useEffect, useMemo, useRef, useState } from "react";
import { api, type CvProfile, type MasterCv, type TailoringSuggestion, type ToggleNode } from "../lib/api";

const MIN_PREVIEW_HEIGHT = 500;

interface SectionGroup {
  label: string;
  section: ToggleNode;
  items: ToggleNode[];
}

interface SectionCardProps {
  group: SectionGroup;
  sectionHidden: boolean;
  sectionOverridden: boolean;
  effectiveHidden: (node: ToggleNode) => boolean;
  isOverridden: (node: ToggleNode) => boolean;
  onToggle: (node: ToggleNode) => void;
  reorder?: { isFirst: boolean; isLast: boolean; onMoveUp: () => void; onMoveDown: () => void };
}

// Shared by both the reorderable and non-reorderable section lists — the
// only difference between them is whether `reorder` controls are present.
function SectionCard({ group, sectionHidden, sectionOverridden, effectiveHidden, isOverridden, onToggle, reorder }: SectionCardProps) {
  return (
    <div className="section-card">
      <div className={`toggle-row section-header${sectionOverridden ? " overridden" : ""}`}>
        <input type="checkbox" checked={!sectionHidden} onChange={() => onToggle(group.section)} />
        <span className="section-label">{group.label}</span>
        {sectionOverridden && <span className="override-tag">overridden</span>}
        {reorder && (
          <span className="reorder-controls">
            <button type="button" className="reorder-btn" title="Move section up" disabled={reorder.isFirst} onClick={reorder.onMoveUp}>
              ↑
            </button>
            <button type="button" className="reorder-btn" title="Move section down" disabled={reorder.isLast} onClick={reorder.onMoveDown}>
              ↓
            </button>
          </span>
        )}
      </div>
      {!sectionHidden &&
        group.items.map((item) => {
          const itemOverridden = isOverridden(item);
          return (
            <div key={item.key} className={`toggle-row item${itemOverridden ? " overridden" : ""}`}>
              <input type="checkbox" checked={!effectiveHidden(item)} onChange={() => onToggle(item)} />
              <span>{item.itemLabel}</span>
              {itemOverridden && <span className="override-tag">overridden</span>}
            </div>
          );
        })}
    </div>
  );
}

export default function CvEditor() {
  const [master, setMaster] = useState<MasterCv | null>(null);
  const [masterMissing, setMasterMissing] = useState(false);
  const [toggles, setToggles] = useState<ToggleNode[]>([]);
  const [profiles, setProfiles] = useState<CvProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const [order, setOrder] = useState<string[]>([]);
  // The section keys render.ts's PDF/preview dispatch table actually knows
  // how to draw, in render order — fetched once from the backend (single
  // source of truth, see cv.ts's /render-order) rather than kept as a
  // second hardcoded copy here that could drift from the real renderer.
  const [renderSectionKeys, setRenderSectionKeys] = useState<string[]>([]);
  const [newProfileName, setNewProfileName] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [renderMsg, setRenderMsg] = useState<string | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [targetRole, setTargetRole] = useState("");
  const [suggestions, setSuggestions] = useState<TailoringSuggestion[] | null>(null);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [previewHeight, setPreviewHeight] = useState(MIN_PREVIEW_HEIGHT);
  const previewRef = useRef<HTMLIFrameElement>(null);

  // The preview iframe is same-origin (served via the /api proxy), so we can
  // read its rendered document height and grow the iframe to fit — a CV that
  // runs long (or short) is shown in full instead of scrolling inside a
  // fixed-height box.
  function resizePreview() {
    const doc = previewRef.current?.contentDocument;
    if (!doc) return;
    const height = doc.documentElement.scrollHeight;
    if (height > 0) setPreviewHeight(Math.max(height, MIN_PREVIEW_HEIGHT));
  }

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
    api.cv.renderOrder().then(setRenderSectionKeys);
  }, []);

  const selectedProfile = profiles.find((p) => p.id === selectedId) ?? null;

  useEffect(() => {
    setVisibility(selectedProfile?.visibility ?? {});
    setOrder(selectedProfile?.order?.length ? selectedProfile.order : renderSectionKeys);
  }, [selectedProfile, renderSectionKeys]);

  const grouped = useMemo(() => {
    const bySection = new Map<string, SectionGroup>();
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

  // Reorderable groups follow `order` (the profile's persisted section order,
  // which also drives the PDF/preview render — see render.ts's buildHtml).
  // Groups whose sectionKey isn't in renderSectionKeys (custom sections, or
  // CV-JSON-native keys the renderer has no dispatch entry for) are
  // appended after, unordered, with no reorder controls.
  const { orderedGroups, unorderedGroups } = useMemo(() => {
    const bySectionKey = new Map(grouped.map((g) => [g.section.sectionKey, g]));
    const renderableKeys = new Set(renderSectionKeys);
    const seen = new Set<string>();
    const ordered: typeof grouped = [];
    for (const key of order) {
      const g = bySectionKey.get(key);
      if (g && renderableKeys.has(key) && !seen.has(key)) {
        ordered.push(g);
        seen.add(key);
      }
    }
    // A renderable section missing from this profile's saved `order` (a key
    // added after the profile was created, or a legacy profile) still
    // belongs in the reorderable list, just appended at the end — it's
    // renderable capability that decides this bucket, not current order.
    for (const g of grouped) {
      if (renderableKeys.has(g.section.sectionKey) && !seen.has(g.section.sectionKey)) {
        ordered.push(g);
        seen.add(g.section.sectionKey);
      }
    }
    const unordered = grouped.filter((g) => !renderableKeys.has(g.section.sectionKey));
    return { orderedGroups: ordered, unorderedGroups: unordered };
  }, [grouped, order, renderSectionKeys]);

  function moveSection(sectionKey: string, direction: -1 | 1) {
    setOrder((prev) => {
      const idx = prev.indexOf(sectionKey);
      const swapIdx = idx + direction;
      if (idx === -1 || swapIdx < 0 || swapIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
  }

  function effectiveHidden(node: ToggleNode): boolean {
    return visibility[node.key] ?? node.hidden;
  }

  // Overridden means the profile's visibility map carries an explicit key for
  // this node — not "differs from master." A section toggled off then back on
  // still has an explicit key even though its effective value now matches the
  // master again, and that's accurate: applyVisibility treats key-presence as
  // "override applies," so the marker reflects the real data model.
  function isOverridden(node: ToggleNode): boolean {
    return Object.prototype.hasOwnProperty.call(visibility, node.key);
  }

  function toggle(node: ToggleNode) {
    setVisibility((v) => ({ ...v, [node.key]: !effectiveHidden(node) }));
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const text = await file.text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          `"${file.name}" isn't valid JSON. This app needs an rxresume-style CV JSON export, not a PDF/Word doc — ` +
            "if your CV isn't in that format yet, tell me what you have and I'll help convert it.",
        );
      }
      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        throw new Error(`"${file.name}" parsed as JSON but isn't a CV object (got ${Array.isArray(data) ? "an array" : typeof data}).`);
      }
      await api.cv.saveMaster("master", data);
      await loadMaster();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function createProfile() {
    if (!master || !newProfileName.trim()) return;
    setProfileError(null);
    try {
      // Guard against the render-order fetch not having resolved yet (the
      // effect that populates it fires in parallel with loadMaster) — an
      // empty order would persist as an empty array, not fall back to the
      // backend's default, and render zero sections in that profile's PDF.
      const order = renderSectionKeys.length ? renderSectionKeys : await api.cv.renderOrder();
      const profile = await api.cv.createProfile({
        masterCvId: master.id,
        name: newProfileName.trim(),
        visibility: {},
        order,
        style: "default",
      });
      setNewProfileName("");
      setProfiles(await api.cv.listProfiles(master.id));
      setSelectedId(profile.id);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveChanges() {
    if (!selectedProfile) return;
    setSaveError(null);
    try {
      await api.cv.updateProfile(selectedProfile.id, { visibility, order });
      if (master) setProfiles(await api.cv.listProfiles(master.id));
      setPreviewNonce((n) => n + 1);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
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
  // existing "Save changes" button persists anything. Nothing here bypasses
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
          <input type="file" accept="application/json" onChange={handleUpload} disabled={uploading} />
          {uploading && <p style={{ color: "var(--muted)" }}>Uploading…</p>}
          {uploadError && <div className="alert alert-error" style={{ marginTop: 12 }}>{uploadError}</div>}
        </div>
      </section>
    );
  }

  if (!master) return <p>Loading…</p>;

  const masterData = master.data && typeof master.data === "object" ? (master.data as { basics?: { name?: unknown } }) : {};
  const masterNameRaw = masterData.basics?.name;
  const masterName = (typeof masterNameRaw === "string" ? masterNameRaw.trim() : "") || "Untitled CV";

  return (
    <section>
      <h2>CV Editor</h2>

      <div className="panel row" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>Master CV:</strong> {masterName}
          <span style={{ color: "var(--muted)", marginLeft: 8 }}>
            {profiles.length} profile{profiles.length === 1 ? "" : "s"} built from it
          </span>
        </div>
        <label className="btn btn-ghost" style={{ margin: 0, cursor: uploading ? "default" : "pointer", opacity: uploading ? 0.6 : 1 }}>
          {uploading ? "Uploading…" : "Replace master CV"}
          <input type="file" accept="application/json" onChange={handleUpload} disabled={uploading} className="visually-hidden" />
        </label>
      </div>
      {uploadError && <div className="alert alert-error" style={{ marginBottom: 16 }}>{uploadError}</div>}
      {profiles.length > 0 && (
        <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: -8, marginBottom: 16 }}>
          Replacing swaps the CV content only — your profiles and their toggles stay, but overrides for
          items that no longer exist in the new CV just won't apply until you re-tailor them.
        </p>
      )}

      <div className="panel row">
        <select
          className="profile-select"
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(e.target.value || null)}
        >
          <option value="">— select a sector profile —</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input placeholder="New profile name (e.g. Corporate)" value={newProfileName} onChange={(e) => setNewProfileName(e.target.value)} />
        <button type="button" className="btn btn-ghost" onClick={createProfile}>
          Create profile
        </button>
      </div>
      {profileError && <div className="alert alert-error" style={{ marginBottom: 16 }}>{profileError}</div>}

      {selectedProfile ? (
        <>
          <div className="ai-panel">
            <div className="row">
              <input
                placeholder="Target role, e.g. 'ML internship at an early-stage startup'"
                value={targetRole}
                onChange={(e) => setTargetRole(e.target.value)}
                style={{ minWidth: 340 }}
              />
              <button type="button" className="btn btn-primary" onClick={runSuggest} disabled={suggesting || !targetRole.trim()}>
                {suggesting ? "Asking local model… (can take ~1 min)" : "Suggest with AI (local, via Ollama)"}
              </button>
            </div>
            {suggestError && <div className="alert alert-error">{suggestError}</div>}

            {suggestions && (
              <div style={{ marginTop: 12 }}>
                <div className="alert alert-info" style={{ marginBottom: 10 }}>
                  Suggestions are not applied yet — review, then apply the ones you accept.
                </div>
                {suggestions.map((s) => (
                  <div key={s.key} className="ai-suggestion">
                    <span className="ai-badge">AI</span>
                    <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={accepted[s.key] ?? false}
                        onChange={() => setAccepted((a) => ({ ...a, [s.key]: !a[s.key] }))}
                      />
                      <span>
                        <strong>{s.label}</strong> → {s.suggestedHidden ? "hide" : "show"}{" "}
                        <span style={{ color: "var(--muted)" }}>({s.reason})</span>
                      </span>
                    </label>
                  </div>
                ))}
                <div className="row" style={{ marginTop: 8 }}>
                  <button type="button" className="btn btn-secondary" onClick={applyAcceptedSuggestions}>
                    Apply accepted suggestions to toggles
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setSuggestions(null)}>
                    Discard
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="cv-layout">
            <div>
              {orderedGroups.map((group, i) => (
                <SectionCard
                  key={group.section.key}
                  group={group}
                  sectionHidden={effectiveHidden(group.section)}
                  sectionOverridden={isOverridden(group.section)}
                  effectiveHidden={effectiveHidden}
                  isOverridden={isOverridden}
                  onToggle={toggle}
                  reorder={{
                    isFirst: i === 0,
                    isLast: i === orderedGroups.length - 1,
                    onMoveUp: () => moveSection(group.section.sectionKey, -1),
                    onMoveDown: () => moveSection(group.section.sectionKey, 1),
                  }}
                />
              ))}

              {unorderedGroups.length > 0 && (
                <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "12px 0 4px" }}>
                  Not rendered in the PDF, so not reorderable — this CV's own extra sections beyond the fixed
                  render list:
                </p>
              )}
              {unorderedGroups.map((group) => (
                <SectionCard
                  key={group.section.key}
                  group={group}
                  sectionHidden={effectiveHidden(group.section)}
                  sectionOverridden={isOverridden(group.section)}
                  effectiveHidden={effectiveHidden}
                  isOverridden={isOverridden}
                  onToggle={toggle}
                />
              ))}

              <div className="row" style={{ marginTop: 4 }}>
                <button type="button" className="btn btn-primary" onClick={saveChanges}>
                  Save changes
                </button>
                <button type="button" className="btn btn-secondary" onClick={renderPdf}>
                  Render PDF
                </button>
                {renderMsg && <span className="alert alert-info">{renderMsg}</span>}
              </div>
              {saveError && <div className="alert alert-error" style={{ marginTop: 8 }}>{saveError}</div>}
            </div>

            <iframe
              key={previewNonce}
              ref={previewRef}
              title="CV preview"
              src={api.cv.previewUrl(selectedProfile.id)}
              onLoad={resizePreview}
              style={{
                width: "100%",
                height: `${previewHeight}px`,
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                boxShadow: "var(--shadow-card)",
                background: "#fff",
              }}
            />
          </div>
        </>
      ) : (
        <p>Select or create a sector profile to start toggling sections/items.</p>
      )}
    </section>
  );
}
