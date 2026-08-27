// Renders one canvas object from a fully-prepared descriptor `d` (built in
// CardScreen, mirroring the original prototype's renderVals() object shape).
export default function ObjectView({ d }) {
  return (
    <div id={`obj-${d.id}`} style={d.style} onPointerDown={d.onDown} onDoubleClick={d.onEdit}>
      {d.isText && (
        <>
          {d.isEditing && (
            <div
              onBlur={d.onBoxBlur}
              style={{
                background: 'var(--white)',
                borderRadius: 12,
                padding: '8px 10px',
                boxShadow: '0 0 0 1.5px color-mix(in srgb,var(--blue) 40%,transparent)',
              }}
            >
              <textarea
                id={d.taId}
                value={d.text}
                onChange={d.onTextChange}
                placeholder="Write something…"
                style={d.taStyle}
              />
              {d.showEditSign && (
                <div style={d.editSignRowStyle}>
                  <input
                    id={d.editSignId}
                    value={d.editSignValue}
                    onChange={d.onEditSignChange}
                    onKeyDown={d.onEditSignKey}
                    placeholder="— Sign your name…"
                    style={d.editSignStyle}
                  />
                </div>
              )}
            </div>
          )}
          {d.notEditing && (
            <div>
              <div style={d.textStyle}>{d.text}</div>
              {d.showSig && <div style={d.sigStyle}>{d.sigName}</div>}
              {d.showPlaceholder && <div style={d.placeholderStyle}>— Sign your name…</div>}
            </div>
          )}
        </>
      )}

      {d.isPhoto && (
        <div style={d.photoCardStyle}>
          <div onClick={d.onPhotoTap} onPointerDown={d.photoAreaDown} dangerouslySetInnerHTML={d.photoHtml} />
          {d.editingCaption && (
            <input
              id={d.capId}
              value={d.caption}
              onChange={d.onCapChange}
              onKeyDown={d.onCapKey}
              onBlur={d.onCapBlur}
              onPointerDown={d.capDown}
              placeholder="Add a caption…"
              style={d.capInputStyle}
            />
          )}
          {d.notEditingCaption && (
            <div onClick={d.onEditCap} onPointerDown={d.capDown} style={d.captionStyle}>
              {d.captionDisplay}
            </div>
          )}
        </div>
      )}

      {d.isSvg && <div dangerouslySetInnerHTML={d.svgHtml} />}

      {d.showFrame && (
        <>
          <div style={{ position: 'absolute', inset: -8, border: '1.5px solid var(--blue)', borderRadius: 12, pointerEvents: 'none' }} />
          <div
            onPointerDown={d.onRotate}
            title="Rotate"
            style={{
              position: 'absolute',
              left: '50%',
              top: -40,
              transform: 'translateX(-50%)',
              width: 26,
              height: 26,
              borderRadius: 999,
              background: 'var(--white)',
              border: '1.5px solid var(--blue)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'grab',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-3-6.7"></path>
              <path d="M21 3v5h-5"></path>
            </svg>
          </div>
          <div
            onPointerDown={d.onResize}
            title="Resize"
            style={{
              position: 'absolute',
              right: -13,
              bottom: -13,
              width: 26,
              height: 26,
              borderRadius: 999,
              background: 'var(--white)',
              border: '1.5px solid var(--blue)',
              cursor: 'nwse-resize',
              boxShadow: 'var(--shadow-sm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6"></path>
              <path d="M9 21H3v-6"></path>
              <path d="M21 3l-7 7"></path>
              <path d="M3 21l7-7"></path>
            </svg>
          </div>
          <div
            onPointerDown={d.onDeleteDown}
            onClick={d.onDelete}
            title="Remove"
            style={{
              position: 'absolute',
              left: -13,
              top: -13,
              width: 26,
              height: 26,
              borderRadius: 999,
              background: 'var(--white)',
              border: '1px solid var(--line-strong)',
              cursor: 'pointer',
              boxShadow: 'var(--shadow-sm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18"></path>
              <path d="M6 6l12 12"></path>
            </svg>
          </div>
        </>
      )}
    </div>
  );
}
