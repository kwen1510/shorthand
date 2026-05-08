(function () {
  "use strict";

  const DB_NAME = "minute-staker-v2";
  const DB_VERSION = 1;
  const AUDIO_CHUNK_MS = 3000;
  const SAVE_DEBOUNCE_MS = 240;
  const HEARTBEAT_MS = 2000;
  const SUPPORTED_BROWSER_PATTERN = /(Chrome|Edg)\//;

  const state = {
    db: null,
    session: null,
    sections: [],
    rowsBySection: new Map(),
    attendees: [],
    recentSessions: [],
    sessionSummaries: new Map(),
    restoreBannerSessionId: null,
    mediaStream: null,
    mediaRecorder: null,
    currentSegmentId: null,
    chunkIndexBySegment: new Map(),
    pendingRecorderFlushes: [],
    isBusy: false,
    heartbeatTimer: null,
    elapsedTimer: null,
    storageEstimateTimer: null,
    pendingSaves: new Map(),
    currentSaveLabel: "Waiting",
    environmentReady: false,
    micTestStream: null,
    micTestAudioContext: null,
    micTestAnalyser: null,
    micTestAnimationFrame: null,
    speakerSuggestionIndex: -1,
    speakerOptionPointerActive: false,
    draggingSectionId: null,
    startPromptTimer: null,
    playbackAudio: null,
    playbackUrl: "",
    playbackSectionId: null,
    playbackStopAtSeconds: null,
  };

  const dom = {
    environmentMessage: document.getElementById("environmentMessage"),
    sessionTitleInput: document.getElementById("sessionTitleInput"),
    audioSourceSelect: document.getElementById("audioSourceSelect"),
    testMicButton: document.getElementById("testMicButton"),
    micTestPanel: document.getElementById("micTestPanel"),
    micTestMeterFill: document.getElementById("micTestMeterFill"),
    closeMicTestButton: document.getElementById("closeMicTestButton"),
    speakerBankToggle: document.getElementById("speakerBankToggle"),
    sessionStateValue: document.getElementById("sessionStateValue"),
    elapsedValue: document.getElementById("elapsedValue"),
    saveStateValue: document.getElementById("saveStateValue"),
    recordingIndicator: document.getElementById("recordingIndicator"),
    recordingIndicatorText: document.getElementById("recordingIndicatorText"),
    startButton: document.getElementById("startButton"),
    muteButton: document.getElementById("muteButton"),
    unmuteButton: document.getElementById("unmuteButton"),
    muteModeLabel: document.getElementById("muteModeLabel"),
    stopButton: document.getElementById("stopButton"),
    exportButton: document.getElementById("exportButton"),
    playbackButton: document.getElementById("playbackButton"),
    newSessionButton: document.getElementById("newSessionButton"),
    pastSessionsButton: document.getElementById("pastSessionsButton"),
    attendeeForm: document.getElementById("attendeeForm"),
    attendeeNameInput: document.getElementById("attendeeNameInput"),
    attendeeList: document.getElementById("attendeeList"),
    importSpeakersButton: document.getElementById("importSpeakersButton"),
    markAllPresentButton: document.getElementById("markAllPresentButton"),
    speakerCsvInput: document.getElementById("speakerCsvInput"),
    speakerDrawer: document.getElementById("speakerDrawer"),
    closeSpeakerDrawerButton: document.getElementById("closeSpeakerDrawerButton"),
    drawerBackdrop: document.getElementById("drawerBackdrop"),
    playbackBackdrop: document.getElementById("playbackBackdrop"),
    playbackModal: document.getElementById("playbackModal"),
    closePlaybackButton: document.getElementById("closePlaybackButton"),
    playbackSectionList: document.getElementById("playbackSectionList"),
    sessionsBackdrop: document.getElementById("sessionsBackdrop"),
    sessionsModal: document.getElementById("sessionsModal"),
    closeSessionsButton: document.getElementById("closeSessionsButton"),
    clearStoppedSessionsButton: document.getElementById("clearStoppedSessionsButton"),
    storageUsageValue: document.getElementById("storageUsageValue"),
    storageSummary: document.getElementById("storageSummary"),
    recentSessions: document.getElementById("recentSessions"),
    restoreBanner: document.getElementById("restoreBanner"),
    restoreBannerText: document.getElementById("restoreBannerText"),
    continueRecoveredButton: document.getElementById("continueRecoveredButton"),
    dismissRestoreButton: document.getElementById("dismissRestoreButton"),
    workspaceHeading: document.getElementById("workspaceHeading"),
    emptyState: document.getElementById("emptyState"),
    sectionsContainer: document.getElementById("sectionsContainer"),
    speakerSuggestions: document.getElementById("speakerSuggestions"),
  };

  window.addEventListener("load", initializeApp);

  async function initializeApp() {
    bindEvents();
    updateEnvironmentMessage();
    try {
      state.db = await openDatabase();
      state.environmentReady = isSupportedEnvironment();
      await refreshAudioInputs();
      await refreshAllAttendees();
      await refreshRecentSessions();
      await restoreMostRecentSession();
      if (!state.session) {
        await createNewSession({ focusFirstRow: true });
        return;
      }
      render();
    } catch (error) {
      console.error(error);
      setSaveState("Initialization failed");
      showEnvironmentMessage(`Shorthand could not start: ${error.message}`);
    }
  }

  function bindEvents() {
    dom.speakerBankToggle.addEventListener("click", toggleSpeakerDrawer);
    dom.audioSourceSelect.addEventListener("change", handleAudioSourceChange);
    dom.testMicButton.addEventListener("click", toggleMicTest);
    dom.closeMicTestButton.addEventListener("click", stopMicTest);
    dom.newSessionButton.addEventListener("click", handleCreateNewSession);
    dom.pastSessionsButton.addEventListener("click", openSessionsModal);
    dom.startButton.addEventListener("click", handleStartButton);
    dom.muteButton.addEventListener("click", muteRecording);
    dom.unmuteButton.addEventListener("click", unmuteRecording);
    dom.stopButton.addEventListener("click", stopRecording);
    dom.exportButton.addEventListener("click", exportCurrentSession);
    dom.playbackButton.addEventListener("click", openPlaybackModal);
    dom.attendeeForm.addEventListener("submit", handleAddAttendee);
    dom.attendeeList.addEventListener("click", handleAttendeeListClick);
    dom.importSpeakersButton.addEventListener("click", () => dom.speakerCsvInput.click());
    dom.markAllPresentButton.addEventListener("click", markAllAttendeesPresent);
    dom.speakerCsvInput.addEventListener("change", handleSpeakerCsvImport);
    dom.closeSpeakerDrawerButton.addEventListener("click", closeSpeakerDrawer);
    dom.drawerBackdrop.addEventListener("click", closeSpeakerDrawer);
    dom.closePlaybackButton.addEventListener("click", closePlaybackModal);
    dom.playbackBackdrop.addEventListener("click", closePlaybackModal);
    dom.closeSessionsButton.addEventListener("click", closeSessionsModal);
    dom.sessionsBackdrop.addEventListener("click", closeSessionsModal);
    dom.clearStoppedSessionsButton.addEventListener("click", clearStoppedSessions);
    dom.playbackSectionList.addEventListener("click", handlePlaybackModalClick);
    dom.continueRecoveredButton.addEventListener("click", continueRecoveredSession);
    dom.dismissRestoreButton.addEventListener("click", dismissRestoreBanner);
    dom.recentSessions.addEventListener("click", handleRecentSessionClick);
    dom.sectionsContainer.addEventListener("input", handleSectionInput);
    dom.sectionsContainer.addEventListener("change", handleSectionChange);
    dom.sectionsContainer.addEventListener("keydown", handleSectionKeyDown);
    dom.sectionsContainer.addEventListener("focusin", handleSectionFocusIn);
    dom.sectionsContainer.addEventListener("mousedown", handleSectionMouseDown);
    dom.sectionsContainer.addEventListener("click", handleSectionClick);
    dom.sectionsContainer.addEventListener("dragstart", handleSectionDragStart);
    dom.sectionsContainer.addEventListener("dragover", handleSectionDragOver);
    dom.sectionsContainer.addEventListener("drop", handleSectionDrop);
    dom.sectionsContainer.addEventListener("dragend", handleSectionDragEnd);
    dom.workspaceHeading.addEventListener("input", handleWorkspaceTitleInput);
    dom.workspaceHeading.addEventListener("blur", handleWorkspaceTitleBlur);
    dom.workspaceHeading.addEventListener("keydown", handleWorkspaceTitleKeyDown);
    dom.sessionTitleInput.addEventListener("input", async (event) => {
      await updateSessionTitleFromInput(event.target.value, event.target);
    });
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", flushRecorderChunk);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("keydown", handleGlobalKeyDown);
    navigator.mediaDevices?.addEventListener?.("devicechange", () => {
      void refreshAudioInputs();
    });
  }

  function isSupportedEnvironment() {
    if (location.protocol === "file:") {
      return false;
    }
    if (!("indexedDB" in window) || !("MediaRecorder" in window) || !navigator.mediaDevices?.getUserMedia) {
      return false;
    }
    return SUPPORTED_BROWSER_PATTERN.test(navigator.userAgent || "");
  }

  function updateEnvironmentMessage() {
    const userAgent = navigator.userAgent || "";
    const onLocalhost = ["localhost", "127.0.0.1"].includes(location.hostname);
    if (location.protocol === "file:") {
      showEnvironmentMessage("Open this app through localhost. Browser recording and IndexedDB recovery are intentionally blocked on file://.");
      return;
    }
    if (!onLocalhost) {
      showEnvironmentMessage("Run Shorthand on localhost for the most reliable microphone and storage behavior.");
      return;
    }
    if (!("indexedDB" in window) || !("MediaRecorder" in window)) {
      showEnvironmentMessage("This browser is missing IndexedDB or MediaRecorder support.");
      return;
    }
    if (!(userAgent.includes("Chrome") || userAgent.includes("Edg"))) {
      showEnvironmentMessage("This version is tuned for Chrome or Edge desktop.");
      return;
    }
    showEnvironmentMessage("");
  }

  function showEnvironmentMessage(message) {
    dom.environmentMessage.textContent = message;
    dom.environmentMessage.hidden = !message;
  }

  async function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("sessions")) {
          const store = db.createObjectStore("sessions", { keyPath: "id" });
          store.createIndex("updatedAt", "updatedAt", { unique: false });
          store.createIndex("status", "status", { unique: false });
        }
        if (!db.objectStoreNames.contains("sections")) {
          const store = db.createObjectStore("sections", { keyPath: "id" });
          store.createIndex("sessionId", "sessionId", { unique: false });
        }
        if (!db.objectStoreNames.contains("rows")) {
          const store = db.createObjectStore("rows", { keyPath: "id" });
          store.createIndex("sectionId", "sectionId", { unique: false });
        }
        if (!db.objectStoreNames.contains("attendees")) {
          const store = db.createObjectStore("attendees", { keyPath: "id" });
          store.createIndex("normalizedName", "normalizedName", { unique: true });
          store.createIndex("lastUsedAt", "lastUsedAt", { unique: false });
        }
        if (!db.objectStoreNames.contains("audioSegments")) {
          const store = db.createObjectStore("audioSegments", { keyPath: "id" });
          store.createIndex("sessionId", "sessionId", { unique: false });
        }
        if (!db.objectStoreNames.contains("audioChunks")) {
          const store = db.createObjectStore("audioChunks", { keyPath: "id" });
          store.createIndex("segmentId", "segmentId", { unique: false });
        }
        if (!db.objectStoreNames.contains("exports")) {
          const store = db.createObjectStore("exports", { keyPath: "id" });
          store.createIndex("sessionId", "sessionId", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
  }

  function transaction(storeNames, mode) {
    return state.db.transaction(storeNames, mode);
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function putRecord(storeName, value) {
    const tx = transaction([storeName], "readwrite");
    const request = tx.objectStore(storeName).put(value);
    await requestToPromise(request);
    await transactionDone(tx);
    return value;
  }

  async function deleteRecord(storeName, key) {
    const tx = transaction([storeName], "readwrite");
    const request = tx.objectStore(storeName).delete(key);
    await requestToPromise(request);
    await transactionDone(tx);
  }

  async function getRecord(storeName, key) {
    const tx = transaction([storeName], "readonly");
    const request = tx.objectStore(storeName).get(key);
    const result = await requestToPromise(request);
    await transactionDone(tx);
    return result;
  }

  async function getAllRecords(storeName) {
    const tx = transaction([storeName], "readonly");
    const request = tx.objectStore(storeName).getAll();
    const result = await requestToPromise(request);
    await transactionDone(tx);
    return result;
  }

  async function getAllByIndex(storeName, indexName, key) {
    const tx = transaction([storeName], "readonly");
    const request = tx.objectStore(storeName).index(indexName).getAll(key);
    const result = await requestToPromise(request);
    await transactionDone(tx);
    return result;
  }

  function transactionDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
    });
  }

  async function refreshRecentSessions() {
    const sessions = await getAllRecords("sessions");
    state.recentSessions = sessions
      .sort((left, right) => new Date(right.updatedAt || right.startedAt || 0) - new Date(left.updatedAt || left.startedAt || 0));
    const summaryEntries = await Promise.all(state.recentSessions.map(async (session) => {
      return [session.id, await getSessionStorageSummary(session.id)];
    }));
    state.sessionSummaries = new Map(summaryEntries);
    renderRecentSessions();
    scheduleStorageEstimateRefresh();
  }

  async function getSessionStorageSummary(sessionId) {
    const sections = await getAllByIndex("sections", "sessionId", sessionId);
    let rowCount = 0;
    for (const section of sections) {
      const rows = await getAllByIndex("rows", "sectionId", section.id);
      rowCount += rows.length;
    }

    const segments = await getAllByIndex("audioSegments", "sessionId", sessionId);
    let audioChunkCount = 0;
    let audioBytes = 0;
    for (const segment of segments) {
      const chunks = await getAllByIndex("audioChunks", "segmentId", segment.id);
      audioChunkCount += chunks.length;
      audioBytes += chunks.reduce((sum, chunk) => sum + (chunk.byteLength || chunk.blob?.size || 0), 0);
    }

    const exports = await getAllByIndex("exports", "sessionId", sessionId);
    return {
      sectionCount: sections.length,
      rowCount,
      audioSegmentCount: segments.length,
      audioChunkCount,
      audioBytes,
      exportCount: exports.length,
    };
  }

  async function refreshAllAttendees() {
    state.attendees = (await getAllRecords("attendees"))
      .sort((left, right) => new Date(right.lastUsedAt || 0) - new Date(left.lastUsedAt || 0));
    renderAttendees();
  }

  async function restoreMostRecentSession() {
    if (state.recentSessions.length === 0) {
      return;
    }
    const latestSession = state.recentSessions[0];
    await loadSession(latestSession.id);
    if (shouldShowRestoreBanner(latestSession)) {
      state.restoreBannerSessionId = latestSession.id;
    }
  }

  async function loadSession(sessionId) {
    const session = await getRecord("sessions", sessionId);
    if (!session) {
      return;
    }

    disposePlaybackAudio();
    const sections = (await getAllByIndex("sections", "sessionId", sessionId))
      .sort((left, right) => left.order - right.order);
    const rowsBySection = new Map();

    for (const section of sections) {
      const rows = (await getAllByIndex("rows", "sectionId", section.id))
        .sort((left, right) => left.order - right.order);
      rowsBySection.set(section.id, rows);
    }

    state.session = session;
    state.sections = sections;
    state.rowsBySection = rowsBySection;

    await ensureTrailingBlankRows();
    render();
    startElapsedTicker();
  }

  async function handleCreateNewSession() {
    if (currentSessionHasData()) {
      const message = isRecorderLive()
        ? "This meeting already has content and a recording is in progress. Stop it and create a new meeting?"
        : "This meeting already has content. Create a new meeting anyway?";
      const shouldCreate = window.confirm(message);
      if (!shouldCreate) {
        return;
      }
      if (isRecorderLive()) {
        await stopRecording();
      }
    } else if (isRecorderLive()) {
      const shouldStop = window.confirm("A recording is in progress. Stop it and create a new session?");
      if (!shouldStop) {
        return;
      }
      await stopRecording();
    }
    await createNewSession({ focusFirstRow: true });
  }

  async function clearStoppedSessions() {
    const stoppedSessions = state.recentSessions.filter((session) => session.status === "stopped");
    if (stoppedSessions.length === 0) {
      window.alert("There are no stopped meetings to clear.");
      return;
    }

    const shouldClear = window.confirm(`Clear ${stoppedSessions.length} stopped meeting${stoppedSessions.length === 1 ? "" : "s"} from IndexedDB? Export anything you need first.`);
    if (!shouldClear) {
      return;
    }

    setBusy(true);
    try {
      for (const session of stoppedSessions) {
        await deleteSessionData(session.id);
      }
      if (!state.session || stoppedSessions.some((session) => session.id === state.session?.id)) {
        await createNewSession({ focusFirstRow: false });
      } else {
        await refreshRecentSessions();
      }
      setSaveState("Cleared stopped meetings");
      render();
    } finally {
      setBusy(false);
    }
  }

  async function deleteStoredSession(sessionId) {
    const session = state.recentSessions.find((item) => item.id === sessionId);
    if (!session) {
      return;
    }
    if (session.status !== "stopped") {
      window.alert("Only stopped meetings can be cleared. Stop the meeting first.");
      return;
    }

    const shouldDelete = window.confirm(`Clear "${session.title || "Untitled meeting"}" from IndexedDB? Export it first if you need a copy.`);
    if (!shouldDelete) {
      return;
    }

    setBusy(true);
    try {
      await deleteSessionData(sessionId);
      if (state.session?.id === sessionId) {
        await createNewSession({ focusFirstRow: false });
      } else {
        await refreshRecentSessions();
      }
      setSaveState("Cleared meeting from IndexedDB");
      render();
    } finally {
      setBusy(false);
    }
  }

  async function deleteSessionData(sessionId) {
    const sections = await getAllByIndex("sections", "sessionId", sessionId);
    for (const section of sections) {
      const rows = await getAllByIndex("rows", "sectionId", section.id);
      for (const row of rows) {
        await deleteRecord("rows", row.id);
      }
      await deleteRecord("sections", section.id);
    }

    const segments = await getAllByIndex("audioSegments", "sessionId", sessionId);
    for (const segment of segments) {
      const chunks = await getAllByIndex("audioChunks", "segmentId", segment.id);
      for (const chunk of chunks) {
        await deleteRecord("audioChunks", chunk.id);
      }
      await deleteRecord("audioSegments", segment.id);
    }

    const exports = await getAllByIndex("exports", "sessionId", sessionId);
    for (const exportRecord of exports) {
      await deleteRecord("exports", exportRecord.id);
    }

    await deleteRecord("sessions", sessionId);
    if (state.session?.id === sessionId) {
      disposePlaybackAudio();
      state.session = null;
      state.sections = [];
      state.rowsBySection = new Map();
      state.restoreBannerSessionId = null;
    }
    scheduleStorageEstimateRefresh();
  }

  async function createNewSession(options = {}) {
    disposePlaybackAudio();
    const nowIso = new Date().toISOString();
    const session = {
      id: createId("session"),
      title: buildDefaultSessionTitle(),
      startedAt: null,
      endedAt: null,
      status: "draft",
      recoverable: true,
      selectedInputLabel: getSelectedAudioLabel(),
      selectedInputId: dom.audioSourceSelect.value || "default",
      attendeeIds: [],
      attendanceByAttendeeId: {},
      lastActivityAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const firstSection = buildSection(session.id, 0);
    const firstRow = buildRow(firstSection.id, 0);

    await putRecord("sessions", session);
    await putRecord("sections", firstSection);
    await putRecord("rows", firstRow);

    state.session = session;
    state.sections = [firstSection];
    state.rowsBySection = new Map([[firstSection.id, [firstRow]]]);
    state.restoreBannerSessionId = null;

    await refreshRecentSessions();
    render();
    startElapsedTicker();
    if (options.focusFirstRow) {
      focusFirstEditableRow();
    }
  }

  function buildSection(sessionId, order, options = {}) {
    return {
      id: createId("section"),
      sessionId,
      title: "",
      order,
      startedElapsedMs: typeof options.startedElapsedMs === "number"
        ? options.startedElapsedMs
        : (order === 0 ? 0 : (state.session?.startedAt ? getCurrentElapsedMs() : null)),
      startedAt: new Date().toISOString(),
    };
  }

  function buildRow(sectionId, order) {
    return {
      id: createId("row"),
      sectionId,
      order,
      elapsedMs: null,
      wallClockIso: null,
      speaker: "",
      notes: "",
      timestampLocked: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async function ensureTrailingBlankRows() {
    if (!state.session) {
      return;
    }
    for (const section of state.sections) {
      const rows = state.rowsBySection.get(section.id) || [];
      if (rows.length === 0) {
        const row = buildRow(section.id, 0);
        rows.push(row);
        state.rowsBySection.set(section.id, rows);
        await putRecord("rows", row);
        continue;
      }
      const lastRow = rows[rows.length - 1];
      if (hasRowContent(lastRow)) {
        const blankRow = buildRow(section.id, rows.length);
        rows.push(blankRow);
        state.rowsBySection.set(section.id, rows);
        await putRecord("rows", blankRow);
      }
    }
  }

  async function ensureCurrentSession() {
    if (!state.session) {
      await createNewSession();
    }
    return state.session;
  }

  async function handleStartButton() {
    if (!state.environmentReady) {
      window.alert("Run this app on localhost in Chrome or Edge desktop before recording.");
      return;
    }

    if (!state.session) {
      await createNewSession();
    }

    if (!state.session) {
      return;
    }

    if (state.session.status === "recording" && !isRecorderLive()) {
      await continueRecoveredSession();
      return;
    }

    if (state.session.status === "draft") {
      if (speakerBankIsEmpty()) {
        showSpeakersRequiredError();
        return;
      }
      await startNewAudioSegment(false);
    }
  }

  async function continueRecoveredSession() {
    if (!state.session) {
      return;
    }
    state.restoreBannerSessionId = null;
    renderRestoreBanner();
    if (state.session.status === "muted") {
      await unmuteRecording();
      return;
    }
    await startNewAudioSegment(false);
  }

  async function startNewAudioSegment(reuseExistingStream) {
    if (!state.session || isRecorderLive()) {
      return;
    }

    try {
      stopMicTest();
      setBusy(true);
      setSaveState("Requesting microphone");

      let stream = null;
      if (reuseExistingStream && state.mediaStream && state.mediaStream.getAudioTracks().some((track) => track.readyState === "live")) {
        stream = state.mediaStream;
      } else {
        stream = await requestAudioStream();
        state.mediaStream = stream;
        await refreshAudioInputs();
      }

      const mimeType = pickMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const segmentIndex = await getNextSegmentIndex(state.session.id);
      const segment = {
        id: createId("segment"),
        sessionId: state.session.id,
        segmentIndex,
        startedAt: new Date().toISOString(),
        endedAt: null,
        mimeType: recorder.mimeType || mimeType || "audio/webm",
        status: "recording",
      };

      state.chunkIndexBySegment.set(segment.id, 0);
      state.mediaRecorder = recorder;
      state.currentSegmentId = segment.id;

      recorder.addEventListener("dataavailable", async (event) => {
        try {
          if (!event.data || event.data.size === 0) {
            resolveRecorderFlushes(0);
            return;
          }
          const nextChunkIndex = (state.chunkIndexBySegment.get(segment.id) || 0) + 1;
          state.chunkIndexBySegment.set(segment.id, nextChunkIndex);
          const chunk = {
            id: createId("chunk"),
            segmentId: segment.id,
            chunkIndex: nextChunkIndex,
            blob: event.data,
            durationMs: AUDIO_CHUNK_MS,
            byteLength: event.data.size,
            createdAt: new Date().toISOString(),
          };
          await putRecord("audioChunks", chunk);
          resolveRecorderFlushes(event.data.size);
          scheduleStorageEstimateRefresh();
          setSaveState(`Saved locally (${formatBytes(event.data.size)} chunk)`);
        } catch (error) {
          console.error(error);
          resolveRecorderFlushes(0);
          setSaveState(`Audio save failed: ${error.message}`);
        }
      });

      recorder.addEventListener("stop", async () => {
        await markSegmentStopped(segment.id);
      });

      recorder.addEventListener("error", async () => {
        setSaveState("Microphone error");
        await markSegmentStopped(segment.id);
      });

      await putRecord("audioSegments", segment);

      state.session.status = "recording";
      if (!state.session.startedAt) {
        state.session.startedAt = new Date().toISOString();
      }
      state.session.selectedInputLabel = getSelectedAudioLabel();
      state.session.selectedInputId = dom.audioSourceSelect.value || "default";
      state.session.lastActivityAt = new Date().toISOString();
      state.session.updatedAt = state.session.lastActivityAt;
      await putRecord("sessions", state.session);

      recorder.start(AUDIO_CHUNK_MS);
      startHeartbeat();
      startElapsedTicker();
      setSaveState("Recording locally");
      await refreshRecentSessions();
      render();
    } catch (error) {
      console.error(error);
      setSaveState(`Microphone error: ${error.message}`);
      window.alert(`Microphone access failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function muteRecording() {
    if (!state.session || !isRecorderLive()) {
      return;
    }

    try {
      setBusy(true);
      setSaveState("Saving audio segment before mute");
      await stopActiveRecorder({ releaseStream: true });
      stopHeartbeat();
      state.session.status = "muted";
      state.session.lastActivityAt = new Date().toISOString();
      state.session.updatedAt = state.session.lastActivityAt;
      await putRecord("sessions", state.session);
      await refreshRecentSessions();
      setSaveState("Muted; typing continues");
      render();
    } finally {
      setBusy(false);
    }
  }

  async function unmuteRecording() {
    if (!state.session || state.session.status !== "muted") {
      return;
    }
    await startNewAudioSegment(false);
  }

  async function stopRecording() {
    if (!state.session || state.session.status === "stopped") {
      return;
    }

    try {
      setBusy(true);
      if (isRecorderLive()) {
        setSaveState("Finalizing audio");
        await stopActiveRecorder({ releaseStream: true });
      } else if (state.mediaStream) {
        state.mediaStream.getTracks().forEach((track) => track.stop());
        state.mediaStream = null;
      }
      stopHeartbeat();
      state.restoreBannerSessionId = null;
      const finalSection = state.sections[state.sections.length - 1];
      if (finalSection && typeof finalSection.endedElapsedMs !== "number") {
        finalSection.endedElapsedMs = getCurrentElapsedMs();
        await putRecord("sections", finalSection);
      }
      state.session.status = "stopped";
      state.session.endedAt = new Date().toISOString();
      state.session.lastActivityAt = state.session.endedAt;
      state.session.updatedAt = state.session.endedAt;
      await putRecord("sessions", state.session);
      await refreshRecentSessions();
      setSaveState("Stopped and saved locally");
      render();
    } finally {
      setBusy(false);
    }
  }

  async function saveRecordingCheckpoint(label) {
    if (!state.session || !isRecorderLive()) {
      return false;
    }
    setSaveState(label || "Saving audio checkpoint");
    const saved = await flushRecorderChunk({ waitForWrite: true });
    setSaveState(saved ? "Section audio checkpoint saved" : "Recording checkpoint requested");
    return saved;
  }

  async function stopActiveRecorder(options) {
    const releaseStream = Boolean(options && options.releaseStream);
    const recorder = state.mediaRecorder;
    const stream = state.mediaStream;

    state.mediaRecorder = null;
    state.currentSegmentId = null;

    if (recorder && recorder.state !== "inactive") {
      const finalFlush = waitForNextRecorderFlush();
      await new Promise((resolve, reject) => {
        recorder.addEventListener("stop", resolve, { once: true });
        recorder.addEventListener("error", () => resolve(), { once: true });
        try {
          recorder.requestData();
          recorder.stop();
        } catch (error) {
          resolveRecorderFlushes(0);
          reject(error);
        }
      });
      await finalFlush;
    }

    if (releaseStream && stream) {
      stream.getTracks().forEach((track) => track.stop());
      if (state.mediaStream === stream) {
        state.mediaStream = null;
      }
    } else {
      state.mediaStream = stream || state.mediaStream;
    }
  }

  async function markSegmentStopped(segmentId) {
    const segment = await getRecord("audioSegments", segmentId);
    if (!segment || segment.endedAt) {
      return;
    }
    segment.endedAt = new Date().toISOString();
    segment.status = "saved";
    await putRecord("audioSegments", segment);
  }

  function requestAudioStream() {
    const selectedId = dom.audioSourceSelect.value;
    const constraints = selectedId && selectedId !== "default"
      ? { audio: { deviceId: { exact: selectedId } } }
      : { audio: true };
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  function handleAudioSourceChange() {
    if (!state.micTestStream) {
      return;
    }
    void restartMicTest();
  }

  async function toggleMicTest() {
    if (state.micTestStream) {
      stopMicTest();
      return;
    }
    await startMicTest();
  }

  async function restartMicTest() {
    stopMicTest();
    await startMicTest();
  }

  async function startMicTest() {
    if (isRecorderLive()) {
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      setSaveState("Mic test unavailable in this browser");
      return;
    }

    try {
      const stream = await requestAudioStream();
      state.micTestStream = stream;
      const audioContext = new AudioContextClass();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);

      state.micTestAudioContext = audioContext;
      state.micTestAnalyser = analyser;
      dom.micTestPanel.hidden = false;
      dom.testMicButton.textContent = "Stop Test";
      renderButtons();
      updateMicTestMeter();
    } catch (error) {
      stopMicTest();
      console.error(error);
      setSaveState(`Mic test failed: ${error.message}`);
    }
  }

  function updateMicTestMeter() {
    if (!state.micTestAnalyser || !dom.micTestMeterFill) {
      return;
    }

    const samples = new Uint8Array(state.micTestAnalyser.fftSize);
    state.micTestAnalyser.getByteTimeDomainData(samples);
    let peak = 0;
    samples.forEach((sample) => {
      peak = Math.max(peak, Math.abs(sample - 128));
    });
    const level = Math.min(100, Math.round((peak / 64) * 100));
    dom.micTestMeterFill.style.width = `${level}%`;
    state.micTestAnimationFrame = window.requestAnimationFrame(updateMicTestMeter);
  }

  function stopMicTest() {
    if (state.micTestAnimationFrame) {
      window.cancelAnimationFrame(state.micTestAnimationFrame);
      state.micTestAnimationFrame = null;
    }
    if (state.micTestStream) {
      state.micTestStream.getTracks().forEach((track) => track.stop());
      state.micTestStream = null;
    }
    if (state.micTestAudioContext) {
      void state.micTestAudioContext.close().catch(() => {});
      state.micTestAudioContext = null;
    }
    state.micTestAnalyser = null;
    if (dom.micTestMeterFill) {
      dom.micTestMeterFill.style.width = "0%";
    }
    if (dom.micTestPanel) {
      dom.micTestPanel.hidden = true;
    }
    if (dom.testMicButton) {
      dom.testMicButton.textContent = "Test Mic";
    }
    renderButtons();
  }

  async function addSection(options = {}) {
    const session = await ensureCurrentSession();
    if (!session) {
      return;
    }
    const boundaryElapsedMs = session.startedAt ? getCurrentElapsedMs() : null;
    let checkpointSavedAt = null;
    if (session.status === "recording" && isRecorderLive()) {
      await saveRecordingCheckpoint("Saving section audio checkpoint");
      checkpointSavedAt = new Date().toISOString();
    }

    const previousSection = state.sections[state.sections.length - 1];
    if (previousSection && checkpointSavedAt) {
      previousSection.endedElapsedMs = boundaryElapsedMs;
      previousSection.audioCheckpointSavedAt = checkpointSavedAt;
      await putRecord("sections", previousSection);
    }

    const newSection = buildSection(session.id, state.sections.length, { startedElapsedMs: boundaryElapsedMs });
    if (checkpointSavedAt) {
      newSection.audioCheckpointStartedAt = checkpointSavedAt;
    }
    const firstRow = buildRow(newSection.id, 0);
    state.sections.push(newSection);
    state.rowsBySection.set(newSection.id, [firstRow]);

    await putRecord("sections", newSection);
    await putRecord("rows", firstRow);
    await touchSession();
    renderSections();
    if (options.focus !== false && !isMinutesEntryLocked()) {
      focusFirstEditableRow(newSection.id);
    }
  }

  async function addRow(sectionId) {
    const rows = state.rowsBySection.get(sectionId) || [];
    const newRow = buildRow(sectionId, rows.length);
    rows.push(newRow);
    state.rowsBySection.set(sectionId, rows);
    await putRecord("rows", newRow);
    await touchSession();
    appendRowToDom(sectionId, newRow);
  }

  async function exportCurrentSession() {
    if (!state.session) {
      window.alert("Create or load a session first.");
      return;
    }
    if (state.session.status !== "stopped") {
      window.alert("Stop the session before exporting the final ZIP bundle.");
      return;
    }

    try {
      setBusy(true);
      setSaveState("Preparing export");
      const exportData = await buildExportData(state.session.id);
      const docxBlob = await window.MinuteStakerExport.createDocxBlob(exportData.docxData);
      const docxBytes = new Uint8Array(await docxBlob.arrayBuffer());
      const jsonBytes = window.MinuteStakerExport.stringToBytes(JSON.stringify(exportData.jsonData, null, 2));
      const aiBotJsonBytes = window.MinuteStakerExport.stringToBytes(JSON.stringify(exportData.aiBotJsonData, null, 2));

      const files = [
        { name: "minutes.docx", data: docxBytes },
        { name: "session.json", data: jsonBytes },
        { name: "upload-this-to-ai-bots.json", data: aiBotJsonBytes },
      ];

      for (const audioFile of exportData.audioFiles) {
        const buffer = await audioFile.blob.arrayBuffer();
        files.push({ name: audioFile.name, data: new Uint8Array(buffer) });
      }

      const bundleBytes = window.MinuteStakerExport.createZip(files);
      const bundleBlob = new Blob([bundleBytes], { type: "application/zip" });
      const fileName = `${sanitizeFileName(exportData.docxData.title || "minutes")}-bundle.zip`;

      await putRecord("exports", {
        id: createId("export"),
        sessionId: state.session.id,
        createdAt: new Date().toISOString(),
        fileName,
      });
      await refreshRecentSessions();

      window.MinuteStakerExport.downloadBlob(bundleBlob, fileName);
      setSaveState("Exported bundle locally");
    } catch (error) {
      console.error(error);
      setSaveState(`Export failed: ${error.message}`);
      window.alert(`Export failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function buildExportData(sessionId) {
    const session = await getRecord("sessions", sessionId);
    const sections = (await getAllByIndex("sections", "sessionId", sessionId))
      .sort((left, right) => left.order - right.order);
    const attendees = await getAllRecords("attendees");
    const attendance = buildAttendanceExport(session, attendees);
    const segments = (await getAllByIndex("audioSegments", "sessionId", sessionId))
      .sort((left, right) => left.segmentIndex - right.segmentIndex);

    const sectionExports = [];
    for (const section of sections) {
      const rows = (await getAllByIndex("rows", "sectionId", section.id))
        .sort((left, right) => left.order - right.order)
        .filter((row) => hasRowContent(row) || row.timestampLocked);

      sectionExports.push({
        id: section.id,
        title: getSectionDisplayTitle(section),
        order: section.order,
        rows: rows.map((row) => ({
          id: row.id,
          elapsedMs: row.elapsedMs,
          elapsedLabel: formatElapsed(row.elapsedMs),
          wallClockIso: row.wallClockIso,
          speaker: row.speaker,
          notes: row.notes,
        })),
      });
    }

    const audioFiles = [];
    for (const segment of segments) {
      const chunks = (await getAllByIndex("audioChunks", "segmentId", segment.id))
        .sort((left, right) => left.chunkIndex - right.chunkIndex);
      const blob = new Blob(chunks.map((chunk) => chunk.blob), { type: segment.mimeType || "audio/webm" });
      audioFiles.push({
        name: `audio/segment-${String(segment.segmentIndex).padStart(3, "0")}.webm`,
        blob,
      });
    }

    const exportedAt = new Date();
    const docxData = {
      title: session.title || buildDefaultSessionTitle(),
      startedAtLabel: session.startedAt ? formatAbsolute(session.startedAt) : "Not recorded",
      exportedAtLabel: formatAbsolute(exportedAt.toISOString()),
      exportedAtIso: exportedAt.toISOString(),
      attendance,
      sections: sectionExports,
    };

    const aiBotJsonData = buildAiBotUploadJson(docxData);
    const jsonData = {
      session,
      attendees,
      attendance,
      sections: sectionExports,
      audioSegments: segments,
      audioFiles: audioFiles.map((file) => file.name),
      aiBotFile: "upload-this-to-ai-bots.json",
      exportedAt: exportedAt.toISOString(),
    };

    return { docxData, jsonData, aiBotJsonData, audioFiles };
  }

  function buildAiBotUploadJson(docxData) {
    return {
      "upload this to AI bots": {
        title: docxData.title,
        sessionStarted: docxData.startedAtLabel,
        exportedAt: docxData.exportedAtLabel,
        attendance: docxData.attendance.map((item) => ({
          member: item.displayName,
          attendance: capitalizeStatus(item.status),
        })),
        sections: docxData.sections.map((section) => ({
          title: section.title,
          rows: section.rows.map((row) => ({
            timestamp: row.elapsedLabel,
            speaker: row.speaker,
            notes: row.notes,
          })),
        })),
      },
    };
  }

  function capitalizeStatus(status) {
    const value = String(status || "").trim();
    return value ? value[0].toUpperCase() + value.slice(1).toLowerCase() : "";
  }

  async function handleAddAttendee(event) {
    event.preventDefault();
    const name = dom.attendeeNameInput.value.trim();
    if (!name) {
      return;
    }
    const attendee = await upsertAttendee(name, { source: "manual" });
    await addAttendeesToCurrentSession([attendee], "absent");
    dom.attendeeNameInput.value = "";
  }

  function handleAttendeeListClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) {
      return;
    }

    if (button.dataset.action === "set-attendance") {
      void setAttendanceStatus(button.dataset.attendeeId, button.dataset.attendanceStatus);
      return;
    }

    if (button.dataset.action === "delete-attendee") {
      void deleteManualAttendee(button.dataset.attendeeId);
    }
  }

  async function upsertAttendee(name, options = {}) {
    const normalizedName = normalizeName(name);
    if (!normalizedName) {
      return;
    }
    const matches = await getAllByIndex("attendees", "normalizedName", normalizedName);
    const aliases = normalizeAliasList(options.aliases || []);
    const source = options.source || "";
    const attendee = matches[0] || {
      id: createId("attendee"),
      name,
      normalizedName,
      aliases: [],
      source: source || (aliases.length > 0 ? "csv" : "manual"),
      lastUsedAt: new Date().toISOString(),
    };
    attendee.name = attendee.name || name;
    attendee.aliases = mergeUniqueStrings(attendee.aliases || [], aliases);
    if (!attendee.source && source) {
      attendee.source = source;
    }
    if (!attendee.source && attendee.aliases.length > 0) {
      attendee.source = "csv";
    }
    attendee.lastUsedAt = new Date().toISOString();
    await putRecord("attendees", attendee);
    await refreshAllAttendees();
    return attendee;
  }

  async function handleSpeakerCsvImport(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }

    try {
      setSaveState("Importing speakers");
      const text = await file.text();
      const speakers = extractSpeakerRecords(text);
      let importedCount = 0;
      const importedAttendees = [];

      for (const speaker of speakers) {
        const attendee = await upsertAttendee(speaker.name, { aliases: speaker.aliases, source: "csv" });
        importedAttendees.push(attendee);
        importedCount += 1;
      }

      await addAttendeesToCurrentSession(importedAttendees, "absent");
      setSaveState(importedCount ? `Imported ${importedCount} speakers` : "No speaker names found");
    } catch (error) {
      console.error(error);
      setSaveState(`CSV import failed: ${error.message}`);
      window.alert(`CSV import failed: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  }

  function extractSpeakerRecords(csvText) {
    const rows = csvText
      .split(/\r?\n/)
      .map(parseCsvRow)
      .filter((row) => row.some((cell) => cell.trim()));

    if (rows.length === 0) {
      return [];
    }

    const header = rows[0].map((cell) => normalizeName(cell));
    const nameIndex = header.findIndex((cell) => ["speaker", "speaker name", "name", "attendee", "participant"].includes(cell));
    const aliasIndex = header.findIndex((cell) => ["alias", "aliases", "short form", "shortform", "abbreviation", "code"].includes(cell));
    const hasHeader = nameIndex >= 0 || aliasIndex >= 0;
    const dataRows = hasHeader ? rows.slice(1) : rows;
    const resolvedNameIndex = nameIndex >= 0 ? nameIndex : 0;
    const recordsByName = new Map();

    dataRows.forEach((row) => {
      const name = (row[resolvedNameIndex] || row.find((cell) => cell.trim()) || "").trim();
      if (!name) {
        return;
      }

      const key = normalizeName(name);
      const aliases = aliasIndex >= 0 ? splitAliases(row[aliasIndex] || "") : [];
      const existing = recordsByName.get(key);
      if (existing) {
        existing.aliases = mergeUniqueStrings(existing.aliases, aliases);
      } else {
        recordsByName.set(key, { name, aliases });
      }
    });

    return [...recordsByName.values()];
  }

  function parseCsvRow(line) {
    const cells = [];
    let current = "";
    let insideQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];

      if (char === '"') {
        if (insideQuotes && next === '"') {
          current += '"';
          index += 1;
        } else {
          insideQuotes = !insideQuotes;
        }
        continue;
      }

      if (char === "," && !insideQuotes) {
        cells.push(current);
        current = "";
        continue;
      }

      current += char;
    }

    cells.push(current);
    return cells;
  }

  async function addAttendeesToCurrentSession(attendees, defaultStatus) {
    if (!attendees.length) {
      return;
    }

    const session = await ensureCurrentSession();
    if (!session) {
      return;
    }

    ensureSessionAttendance(session);
    attendees.filter(Boolean).forEach((attendee) => {
      if (!session.attendeeIds.includes(attendee.id)) {
        session.attendeeIds.push(attendee.id);
      }
      if (!session.attendanceByAttendeeId[attendee.id]) {
        session.attendanceByAttendeeId[attendee.id] = defaultStatus;
      }
    });

    await touchSession();
    renderAttendees();
  }

  async function markAllAttendeesPresent() {
    if (state.attendees.length === 0) {
      setSaveState("Add speakers before marking attendance");
      return;
    }

    const session = await ensureCurrentSession();
    if (!session) {
      return;
    }

    ensureSessionAttendance(session);
    state.attendees.forEach((attendee) => {
      if (!session.attendeeIds.includes(attendee.id)) {
        session.attendeeIds.push(attendee.id);
      }
      session.attendanceByAttendeeId[attendee.id] = "present";
    });

    await touchSession();
    renderAttendees();
    setSaveState("Marked all speakers present");
  }

  async function setAttendanceStatus(attendeeId, status) {
    if (!["present", "absent"].includes(status)) {
      return;
    }

    const attendee = state.attendees.find((item) => item.id === attendeeId);
    if (!attendee) {
      return;
    }

    const session = await ensureCurrentSession();
    if (!session) {
      return;
    }

    ensureSessionAttendance(session);
    if (!session.attendeeIds.includes(attendeeId)) {
      session.attendeeIds.push(attendeeId);
    }
    session.attendanceByAttendeeId[attendeeId] = status;
    await touchSession();
    renderAttendees();
  }

  async function deleteManualAttendee(attendeeId) {
    const attendee = state.attendees.find((item) => item.id === attendeeId);
    if (!attendee || !isManualAttendee(attendee)) {
      return;
    }

    const shouldDelete = window.confirm(`Delete ${getSpeakerDisplayName(attendee)} from the speaker list?`);
    if (!shouldDelete) {
      return;
    }

    if (state.session) {
      ensureSessionAttendance(state.session);
      state.session.attendeeIds = state.session.attendeeIds.filter((id) => id !== attendeeId);
      delete state.session.attendanceByAttendeeId[attendeeId];
      await putRecord("sessions", state.session);
    }

    await deleteRecord("attendees", attendeeId);
    await refreshAllAttendees();
    renderAttendees();
    setSaveState("Deleted speaker");
  }

  function ensureSessionAttendance(session) {
    if (!Array.isArray(session.attendeeIds)) {
      session.attendeeIds = [];
    }
    if (!session.attendanceByAttendeeId || typeof session.attendanceByAttendeeId !== "object") {
      session.attendanceByAttendeeId = {};
    }
  }

  function getAttendanceStatus(attendee, session = state.session) {
    if (!session || !attendee) {
      return "absent";
    }
    ensureSessionAttendance(session);
    return session.attendanceByAttendeeId[attendee.id] || "absent";
  }

  function getSortedAttendeesForDisplay() {
    return [...state.attendees].sort((left, right) => {
      const leftManual = isManualAttendee(left) ? 0 : 1;
      const rightManual = isManualAttendee(right) ? 0 : 1;
      if (leftManual !== rightManual) {
        return leftManual - rightManual;
      }
      if (leftManual === 0) {
        return new Date(right.lastUsedAt || right.createdAt || 0) - new Date(left.lastUsedAt || left.createdAt || 0);
      }
      return getSpeakerDisplayName(left).localeCompare(getSpeakerDisplayName(right));
    });
  }

  function isManualAttendee(attendee) {
    if (!attendee) {
      return false;
    }
    if (attendee.source === "manual") {
      return true;
    }
    if (attendee.source === "csv") {
      return false;
    }
    return getAttendeeAliases(attendee).length === 0;
  }

  function buildAttendanceExport(session, attendees) {
    if (!session) {
      return [];
    }

    ensureSessionAttendance(session);
    const rosterIds = new Set([
      ...session.attendeeIds,
      ...Object.keys(session.attendanceByAttendeeId),
    ]);

    return attendees
      .filter((attendee) => rosterIds.has(attendee.id))
      .map((attendee) => ({
        id: attendee.id,
        name: attendee.name,
        displayName: getSpeakerDisplayName(attendee),
        aliases: getAttendeeAliases(attendee).map(formatAliasForDisplay),
        status: getAttendanceStatus(attendee, session),
      }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  function speakerBankIsEmpty() {
    return state.attendees.length === 0;
  }

  function toggleSpeakerDrawer() {
    if (!dom.speakerDrawer.hidden) {
      closeSpeakerDrawer();
      return;
    }
    openSpeakerDrawer();
  }

  function openSpeakerDrawer() {
    dom.speakerDrawer.hidden = false;
    dom.drawerBackdrop.hidden = false;
    dom.attendeeNameInput.focus();
  }

  function closeSpeakerDrawer() {
    dom.speakerDrawer.hidden = true;
    dom.drawerBackdrop.hidden = true;
  }

  function openSessionsModal() {
    renderRecentSessions();
    scheduleStorageEstimateRefresh();
    dom.sessionsModal.hidden = false;
    dom.sessionsBackdrop.hidden = false;
    dom.closeSessionsButton.focus({ preventScroll: true });
  }

  function closeSessionsModal() {
    dom.sessionsModal.hidden = true;
    dom.sessionsBackdrop.hidden = true;
  }

  function handleRecentSessionClick(event) {
    const actionTarget = event.target.closest("[data-action]");
    if (!actionTarget) {
      return;
    }
    const action = actionTarget.dataset.action;
    const sessionId = actionTarget.dataset.sessionId;

    if (isRecorderLive()) {
      window.alert("Stop recording before switching sessions.");
      return;
    }

    if (action === "load-session") {
      closeSessionsModal();
      void loadSession(sessionId);
      return;
    }

    if (action === "delete-session") {
      void deleteStoredSession(sessionId);
    }
  }

  async function handleWorkspaceTitleInput(event) {
    await updateSessionTitleFromInput(event.target.textContent || "", event.target);
  }

  function handleWorkspaceTitleBlur() {
    updateDocumentTitle();
  }

  function handleWorkspaceTitleKeyDown(event) {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    dom.workspaceHeading.blur();
  }

  async function updateSessionTitleFromInput(value, sourceElement) {
    if (!state.session) {
      await createNewSession({ focusFirstRow: false });
    }
    if (!state.session) {
      return;
    }

    state.session.title = value;
    syncDocumentTitle(sourceElement);
    scheduleSave("session-title", async () => {
      state.session.title = state.session.title.trim();
      syncDocumentTitle();
      state.session.updatedAt = new Date().toISOString();
      await putRecord("sessions", state.session);
      await refreshRecentSessions();
      setSaveState("Saved locally");
    });
  }

  function handleSectionClick(event) {
    const actionTarget = event.target.closest("[data-action]");
    if (!actionTarget) {
      return;
    }

    const action = actionTarget.dataset.action;
    if (action === "add-row") {
      if (isMinutesEntryLocked()) {
        showStartRequiredError();
        return;
      }
      void addRow(actionTarget.dataset.sectionId);
      return;
    }

    if (action === "add-section") {
      void addSection();
      return;
    }

    if (action === "start-session") {
      void handleStartButton();
      return;
    }

    if (action === "open-speakers") {
      openSpeakerDrawer();
      return;
    }

    if (action === "play-section") {
      void toggleSectionPlayback(actionTarget.dataset.sectionId);
      return;
    }

    if (action === "choose-speaker") {
      if (state.speakerOptionPointerActive) {
        state.speakerOptionPointerActive = false;
        return;
      }
      selectSpeakerOption(actionTarget, { moveToNotes: true });
    }
  }

  function handleSectionMouseDown(event) {
    const actionTarget = event.target.closest('[data-action="choose-speaker"]');
    if (!actionTarget) {
      return;
    }
    if (isMinutesEntryLocked()) {
      showStartRequiredError();
      return;
    }

    event.preventDefault();
    state.speakerOptionPointerActive = true;
    selectSpeakerOption(actionTarget, { moveToNotes: true });
    window.setTimeout(() => {
      state.speakerOptionPointerActive = false;
    }, 500);
  }

  function handleSectionDragStart(event) {
    const handle = event.target.closest("[data-section-drag-handle]");
    if (!handle || !canReorderSections()) {
      event.preventDefault();
      return;
    }

    state.draggingSectionId = handle.dataset.sectionId;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", state.draggingSectionId);
    const card = getSectionCard(state.draggingSectionId);
    card?.classList.add("section-card-dragging");
  }

  function handleSectionDragOver(event) {
    if (!state.draggingSectionId) {
      return;
    }
    const targetCard = getClosestSectionCard(event.target);
    if (!targetCard || targetCard.dataset.sectionId === state.draggingSectionId) {
      clearSectionDropIndicators();
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const position = getSectionDropPosition(targetCard, event.clientY);
    clearSectionDropIndicators();
    targetCard.classList.add(position === "before" ? "section-drop-before" : "section-drop-after");
  }

  function handleSectionDrop(event) {
    if (!state.draggingSectionId) {
      return;
    }
    const targetCard = getClosestSectionCard(event.target);
    if (!targetCard || targetCard.dataset.sectionId === state.draggingSectionId) {
      clearSectionDragState();
      return;
    }

    event.preventDefault();
    const position = getSectionDropPosition(targetCard, event.clientY);
    const draggedSectionId = state.draggingSectionId;
    const targetSectionId = targetCard.dataset.sectionId;
    clearSectionDragState();
    void reorderSection(draggedSectionId, targetSectionId, position);
  }

  function handleSectionDragEnd() {
    clearSectionDragState();
  }

  function getClosestSectionCard(target) {
    return target instanceof Element ? target.closest(".section-card[data-section-id]") : null;
  }

  function getSectionCard(sectionId) {
    return dom.sectionsContainer.querySelector(`.section-card[data-section-id="${cssEscape(sectionId)}"]`);
  }

  function getSectionDropPosition(card, clientY) {
    const rect = card.getBoundingClientRect();
    return clientY < rect.top + (rect.height / 2) ? "before" : "after";
  }

  function clearSectionDragState() {
    state.draggingSectionId = null;
    dom.sectionsContainer.querySelectorAll(".section-card-dragging").forEach((card) => {
      card.classList.remove("section-card-dragging");
    });
    clearSectionDropIndicators();
  }

  function clearSectionDropIndicators() {
    dom.sectionsContainer.querySelectorAll(".section-drop-before, .section-drop-after").forEach((card) => {
      card.classList.remove("section-drop-before", "section-drop-after");
    });
  }

  async function reorderSection(draggedSectionId, targetSectionId, position) {
    if (!canReorderSections() || draggedSectionId === targetSectionId) {
      return;
    }
    const fromIndex = state.sections.findIndex((section) => section.id === draggedSectionId);
    const targetIndex = state.sections.findIndex((section) => section.id === targetSectionId);
    if (fromIndex < 0 || targetIndex < 0) {
      return;
    }

    const [draggedSection] = state.sections.splice(fromIndex, 1);
    let insertIndex = targetIndex + (position === "after" ? 1 : 0);
    if (fromIndex < insertIndex) {
      insertIndex -= 1;
    }
    state.sections.splice(insertIndex, 0, draggedSection);

    await persistSectionOrder();
    renderSections();
    renderButtons();
    if (!dom.playbackModal.hidden) {
      renderPlaybackModal();
    }
    setSaveState("Reordered sections");
  }

  async function persistSectionOrder() {
    for (const [index, section] of state.sections.entries()) {
      if (section.order === index) {
        continue;
      }
      section.order = index;
      await putRecord("sections", section);
    }
    await touchSession();
  }

  function handleSectionFocusIn(event) {
    const target = event.target;
    const sectionId = target.dataset.sectionId;
    const rowId = target.dataset.rowId;
    const field = target.dataset.field;

    if (!sectionId || !rowId || !field) {
      return;
    }

    if (isMinutesRowField(field) && isMinutesEntryLocked()) {
      showStartRequiredError();
      return;
    }

    void maybeAppendTrailingRow(sectionId, rowId, { requireContent: false });
    if (field === "speaker") {
      renderSpeakerOptions(target);
    }
  }

  function handleSectionChange(event) {
    const target = event.target;
    if (target.dataset.field === "section-title") {
      void commitSectionTitle(target);
      return;
    }
    if (target.dataset.field !== "speaker") {
      return;
    }
    if (isMinutesEntryLocked()) {
      showStartRequiredError();
      return;
    }

    commitSpeakerInput(target);
  }

  async function commitSectionTitle(input) {
    const section = state.sections.find((item) => item.id === input.dataset.sectionId);
    if (!section) {
      return;
    }
    section.title = normalizeSectionTitleValue(section, input.value);
    input.value = getSectionDisplayTitle(section);
    await putRecord("sections", section);
    await touchSession();
  }

  function handleSectionKeyDown(event) {
    const target = event.target;
    const field = target.dataset.field;
    if (field === "section-title") {
      handleSectionTitleKeyDown(event, target);
      return;
    }
    if (!isMinutesRowField(field)) {
      return;
    }
    if (isMinutesEntryLocked()) {
      showStartRequiredError();
      return;
    }

    if (field === "notes") {
      handleNotesKeyDown(event, target);
      return;
    }

    if (field !== "speaker") {
      return;
    }

    const options = getSpeakerOptionsElement(target);
    const optionButtons = options ? [...options.querySelectorAll(".speaker-option")] : [];

    if (event.key === "Escape") {
      hideSpeakerOptions();
      return;
    }

    if (event.key === "ArrowUp" && shouldMoveSpeakerToPreviousNotes(target, options, optionButtons)) {
      event.preventDefault();
      hideSpeakerOptions();
      focusPreviousRowNotes(target.dataset.sectionId, target.dataset.rowId);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (optionButtons.length === 0) {
        return;
      }
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = Math.max(0, Math.min(optionButtons.length - 1, state.speakerSuggestionIndex + direction));
      setSpeakerSuggestionIndex(options, nextIndex);
      return;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      const hasQuery = Boolean(target.value.trim());
      const hasExplicitSelection = state.speakerSuggestionIndex >= 0;
      const selectedOption = optionButtons[state.speakerSuggestionIndex] || optionButtons[0] || null;
      if (!hasQuery && event.key === "Tab" && !hasExplicitSelection) {
        return;
      }
      event.preventDefault();
      if ((hasQuery || hasExplicitSelection) && selectedOption) {
        selectSpeakerOption(selectedOption, { moveToNotes: true });
        return;
      }
      commitSpeakerInput(target, { moveToNotes: true });
    }
  }

  function shouldMoveSpeakerToPreviousNotes(input, options, optionButtons) {
    const dropdownIsOpen = options && !options.hidden && optionButtons.length > 0;
    const dropdownIsActive = dropdownIsOpen && (Boolean(input.value.trim()) || state.speakerSuggestionIndex >= 0);
    if (dropdownIsActive) {
      return false;
    }
    if (!input.value.trim()) {
      return true;
    }
    return input.selectionStart === 0 && input.selectionEnd === 0;
  }

  function handleNotesKeyDown(event, textarea) {
    if (event.key !== "ArrowDown") {
      return;
    }
    if (!isCaretOnLastTextLine(textarea)) {
      return;
    }

    event.preventDefault();
    void focusNextRowSpeaker(textarea.dataset.sectionId, textarea.dataset.rowId);
  }

  function handleSectionTitleKeyDown(event, input) {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    input.blur();
  }

  function moveCursorToEnd(input) {
    window.requestAnimationFrame(() => {
      if (document.activeElement !== input || typeof input.setSelectionRange !== "function") {
        return;
      }
      const valueLength = input.value.length;
      input.setSelectionRange(valueLength, valueLength);
    });
  }

  function handleSectionInput(event) {
    const target = event.target;
    const field = target.dataset.field;
    const sectionId = target.dataset.sectionId;
    const rowId = target.dataset.rowId;

    if (field === "section-title") {
      const section = state.sections.find((item) => item.id === sectionId);
      if (!section) {
        return;
      }
      section.title = target.value;
      scheduleSave(`section-${section.id}`, async () => {
        section.title = normalizeSectionTitleValue(section, section.title);
        if (document.activeElement !== target) {
          target.value = getSectionDisplayTitle(section);
        }
        await putRecord("sections", section);
        await touchSession();
      });
      return;
    }

    if (!sectionId || !rowId) {
      return;
    }
    if (isMinutesRowField(field) && isMinutesEntryLocked()) {
      target.value = "";
      showStartRequiredError();
      return;
    }

    const rows = state.rowsBySection.get(sectionId) || [];
    const row = rows.find((item) => item.id === rowId);
    if (!row) {
      return;
    }

    if (field === "speaker") {
      row.speaker = target.value;
      target.classList.remove("speaker-input-error");
      target.removeAttribute("aria-invalid");
      if (event.isTrusted && row.speaker.trim()) {
        lockRowTimestamp(row);
      }
      renderSpeakerOptions(target);
    }

    if (field === "notes") {
      row.notes = target.value;
      autoResizeTextarea(target);
    }

    row.updatedAt = new Date().toISOString();
    void maybeAppendTrailingRow(sectionId, row.id, { requireContent: true });
    scheduleSave(`row-${row.id}`, async () => {
      await putRecord("rows", row);
      await touchSession();
    });
  }

  async function maybeAppendTrailingRow(sectionId, activeRowId, options) {
    const rows = state.rowsBySection.get(sectionId) || [];
    const lastRow = rows[rows.length - 1];
    const requireContent = options?.requireContent !== false;
    if (!lastRow || lastRow.id !== activeRowId || (requireContent && !hasRowContent(lastRow))) {
      return;
    }
    const newRow = buildRow(sectionId, rows.length);
    rows.push(newRow);
    state.rowsBySection.set(sectionId, rows);
    appendRowToDom(sectionId, newRow);
    await putRecord("rows", newRow);
  }

  async function focusNextRowSpeaker(sectionId, rowId) {
    const rows = state.rowsBySection.get(sectionId) || [];
    const currentIndex = rows.findIndex((row) => row.id === rowId);
    if (currentIndex < 0) {
      return;
    }

    let nextRow = rows[currentIndex + 1];
    if (!nextRow) {
      await maybeAppendTrailingRow(sectionId, rowId, { requireContent: false });
      nextRow = rows[currentIndex + 1];
    }
    if (!nextRow) {
      return;
    }

    const nextSpeaker = findRowField(sectionId, nextRow.id, "speaker");
    nextSpeaker?.focus();
  }

  function focusPreviousRowNotes(sectionId, rowId) {
    const speakerFields = [...dom.sectionsContainer.querySelectorAll('[data-field="speaker"]')];
    const currentIndex = speakerFields.findIndex((field) => {
      return field.dataset.sectionId === sectionId && field.dataset.rowId === rowId;
    });
    const previousSpeaker = speakerFields[currentIndex - 1];
    if (!previousSpeaker) {
      return;
    }

    const previousNotes = findRowField(previousSpeaker.dataset.sectionId, previousSpeaker.dataset.rowId, "notes");
    if (!previousNotes) {
      return;
    }
    previousNotes.focus();
    moveCursorToEnd(previousNotes);
  }

  function appendRowToDom(sectionId, row) {
    const container = dom.sectionsContainer.querySelector(`[data-section-rows="${sectionId}"]`);
    if (!container) {
      renderSections();
      return;
    }
    container.insertAdjacentHTML("beforeend", createRowMarkup(sectionId, row));
    const textarea = container.querySelector(`[data-row-id="${row.id}"][data-field="notes"]`);
    if (textarea) {
      autoResizeTextarea(textarea);
    }
  }

  function updateRowTimestampDisplay(rowId, label, locked) {
    const element = dom.sectionsContainer.querySelector(`[data-timestamp-for="${rowId}"]`);
    if (!element) {
      return;
    }
    const chip = element.querySelector(".timestamp-chip");
    if (chip) {
      chip.textContent = label;
    }
    element.classList.toggle("pending", !locked);
  }

  function lockRowTimestamp(row) {
    if (!row || row.timestampLocked) {
      return;
    }
    row.timestampLocked = true;
    row.elapsedMs = getCurrentElapsedMs();
    row.wallClockIso = new Date().toISOString();
    updateRowTimestampDisplay(row.id, formatElapsed(row.elapsedMs), true);
  }

  function lockSpeakerInputTimestamp(input) {
    const rows = state.rowsBySection.get(input.dataset.sectionId) || [];
    const row = rows.find((item) => item.id === input.dataset.rowId);
    lockRowTimestamp(row);
  }

  function scheduleSave(key, callback) {
    const pending = state.pendingSaves.get(key);
    if (pending) {
      window.clearTimeout(pending);
    }
    setSaveState("Saving locally");
    const timeoutId = window.setTimeout(async () => {
      state.pendingSaves.delete(key);
      await callback();
      setSaveState("Saved locally");
    }, SAVE_DEBOUNCE_MS);
    state.pendingSaves.set(key, timeoutId);
  }

  async function touchSession() {
    if (!state.session) {
      return;
    }
    state.session.updatedAt = new Date().toISOString();
    state.session.lastActivityAt = state.session.updatedAt;
    await putRecord("sessions", state.session);
    await refreshRecentSessions();
  }

  function scheduleStorageEstimateRefresh() {
    if (state.storageEstimateTimer) {
      window.clearTimeout(state.storageEstimateTimer);
    }
    state.storageEstimateTimer = window.setTimeout(() => {
      state.storageEstimateTimer = null;
      void refreshStorageEstimate();
    }, 250);
  }

  async function refreshStorageEstimate() {
    if (!navigator.storage?.estimate) {
      dom.storageUsageValue.textContent = "Storage: browser limit unavailable";
      dom.storageSummary.textContent = "This browser does not report IndexedDB storage limits.";
      return;
    }

    try {
      const estimate = await navigator.storage.estimate();
      const usage = estimate.usage || 0;
      const quota = estimate.quota || 0;
      const remaining = Math.max(0, quota - usage);
      const label = quota
        ? `Storage: ${formatBytes(remaining)} free (${formatBytes(usage)} used)`
        : `Storage: ${formatBytes(usage)} used`;
      dom.storageUsageValue.textContent = label;
      dom.storageSummary.textContent = quota
        ? `${formatBytes(remaining)} remaining of ${formatBytes(quota)}. ${formatBytes(usage)} is currently used by this browser origin.`
        : `${formatBytes(usage)} is currently used by this browser origin.`;
    } catch (error) {
      dom.storageUsageValue.textContent = "Storage: unavailable";
      dom.storageSummary.textContent = `Storage estimate unavailable: ${error.message}`;
    }
  }

  async function refreshAudioInputs() {
    const devices = navigator.mediaDevices?.enumerateDevices
      ? await navigator.mediaDevices.enumerateDevices().catch(() => [])
      : [];
    const audioInputs = devices.filter((device) => device.kind === "audioinput");
    const selectedValue = dom.audioSourceSelect.value;
    dom.audioSourceSelect.innerHTML = "";

    if (audioInputs.length === 0) {
      dom.audioSourceSelect.add(new Option("Default microphone", "default"));
      return;
    }

    audioInputs.forEach((device, index) => {
      const label = device.label || `Microphone ${index + 1}`;
      dom.audioSourceSelect.add(new Option(label, device.deviceId));
    });

    dom.audioSourceSelect.value = selectedValue && [...dom.audioSourceSelect.options].some((option) => option.value === selectedValue)
      ? selectedValue
      : dom.audioSourceSelect.options[0].value;
  }

  function pickMimeType() {
    const candidates = ["audio/webm;codecs=opus", "audio/webm"];
    return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || "";
  }

  function startHeartbeat() {
    stopHeartbeat();
    state.heartbeatTimer = window.setInterval(async () => {
      if (!state.session || !isRecorderLive()) {
        return;
      }
      state.session.lastActivityAt = new Date().toISOString();
      state.session.updatedAt = state.session.lastActivityAt;
      await putRecord("sessions", state.session);
      await refreshRecentSessions();
    }, HEARTBEAT_MS);
  }

  function stopHeartbeat() {
    if (state.heartbeatTimer) {
      window.clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
  }

  function startElapsedTicker() {
    if (state.elapsedTimer) {
      window.clearInterval(state.elapsedTimer);
    }
    state.elapsedTimer = window.setInterval(() => {
      dom.elapsedValue.textContent = formatElapsed(getCurrentElapsedMs());
    }, 1000);
    dom.elapsedValue.textContent = formatElapsed(getCurrentElapsedMs());
  }

  function getCurrentElapsedMs() {
    if (!state.session) {
      return 0;
    }
    if (!state.session.startedAt) {
      return 0;
    }
    const startedAt = new Date(state.session.startedAt).getTime();
    const endedAt = state.session.status === "stopped" && state.session.endedAt
      ? new Date(state.session.endedAt).getTime()
      : Date.now();
    return Math.max(0, endedAt - startedAt);
  }

  function handleBeforeUnload(event) {
    if (!isRecorderLive()) {
      return;
    }
    event.preventDefault();
    event.returnValue = "";
  }

  function handleVisibilityChange() {
    if (document.visibilityState === "hidden") {
      flushRecorderChunk();
    }
  }

  function flushRecorderChunk(options = {}) {
    if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
      const waitForWrite = Boolean(options.waitForWrite);
      let writePromise = Promise.resolve(false);
      if (waitForWrite) {
        writePromise = waitForNextRecorderFlush();
      }
      try {
        state.mediaRecorder.requestData();
      } catch (error) {
        console.warn("Recorder flush failed", error);
        resolveRecorderFlushes(0);
      }
      return writePromise;
    }
    return Promise.resolve(false);
  }

  function waitForNextRecorderFlush() {
    return new Promise((resolve) => {
      const pendingFlush = {
        resolve,
        timeoutId: window.setTimeout(() => {
          state.pendingRecorderFlushes = state.pendingRecorderFlushes.filter((item) => item !== pendingFlush);
          resolve(false);
        }, 1800),
      };
      state.pendingRecorderFlushes.push(pendingFlush);
    });
  }

  function resolveRecorderFlushes(byteLength) {
    if (state.pendingRecorderFlushes.length === 0) {
      return;
    }
    const pendingFlushes = state.pendingRecorderFlushes.splice(0);
    pendingFlushes.forEach((pendingFlush) => {
      window.clearTimeout(pendingFlush.timeoutId);
      pendingFlush.resolve(byteLength > 0);
    });
  }

  async function getNextSegmentIndex(sessionId) {
    const segments = await getAllByIndex("audioSegments", "sessionId", sessionId);
    return segments.length + 1;
  }

  function dismissRestoreBanner() {
    state.restoreBannerSessionId = null;
    renderRestoreBanner();
  }

  function render() {
    renderWorkspaceHeading();
    renderStatus();
    renderAttendees();
    renderRecentSessions();
    renderRestoreBanner();
    renderSections();
    renderButtons();
    if (!dom.playbackModal.hidden) {
      renderPlaybackModal();
    }
  }

  function renderWorkspaceHeading() {
    syncDocumentTitle();
    dom.workspaceHeading.contentEditable = state.session ? "true" : "false";
    dom.workspaceHeading.setAttribute("aria-label", state.session ? "Meeting title" : "Workspace title");
    if (document.activeElement !== dom.sessionTitleInput) {
      dom.sessionTitleInput.value = state.session?.title || "";
    }
  }

  function updateDocumentTitle() {
    syncDocumentTitle();
  }

  function syncDocumentTitle(sourceElement) {
    const title = state.session
      ? (state.session.title.trim() || buildDefaultSessionTitle())
      : "Create or load a session";
    if (sourceElement !== dom.workspaceHeading && document.activeElement !== dom.workspaceHeading) {
      dom.workspaceHeading.textContent = title;
    }
    if (sourceElement !== dom.sessionTitleInput && document.activeElement !== dom.sessionTitleInput) {
      dom.sessionTitleInput.value = state.session?.title || "";
    }
  }

  function renderStatus() {
    const sessionState = getDerivedSessionState();
    dom.sessionStateValue.textContent = sessionState.label;
    dom.elapsedValue.textContent = formatElapsed(getCurrentElapsedMs());
    renderSaveState();
    dom.recordingIndicator.hidden = !sessionState.isRecording;
    dom.recordingIndicatorText.textContent = sessionState.isRecording ? "Recording locally" : "Not recording";
    dom.emptyState.hidden = Boolean(state.session);
  }

  function renderButtons() {
    const hasSession = Boolean(state.session);
    const hasStarted = Boolean(state.session?.startedAt);
    const isMuted = hasSession && state.session.status === "muted";
    const isStopped = hasSession && state.session.status === "stopped";
    const canContinueRecovered = hasSession && state.session.status === "recording" && !isRecorderLive();
    const canStartFresh = !hasSession || state.session.status === "draft";
    const canUnmute = hasSession && state.session.status === "muted" && !isRecorderLive();
    const canStop = hasSession && state.session.status !== "stopped";
    const micTestActive = Boolean(state.micTestStream);

    dom.testMicButton.disabled = state.isBusy || isRecorderLive();
    dom.testMicButton.textContent = micTestActive ? "Stop Test" : "Test Mic";
    dom.pastSessionsButton.disabled = state.isBusy;
    dom.startButton.disabled = state.isBusy || isRecorderLive() || (!canContinueRecovered && !canStartFresh);
    dom.startButton.textContent = canContinueRecovered ? "Continue" : "Start";
    dom.muteButton.hidden = !hasStarted || isMuted || isStopped;
    dom.unmuteButton.hidden = !hasStarted || !isMuted || isStopped;
    dom.muteModeLabel.hidden = !isMuted;
    dom.stopButton.hidden = !hasStarted;
    dom.playbackButton.hidden = !isStopped;
    dom.playbackButton.disabled = state.isBusy || !isStopped;
    if (!isStopped && !dom.playbackModal.hidden) {
      closePlaybackModal();
    }
    dom.muteButton.disabled = state.isBusy || !isRecorderLive();
    dom.unmuteButton.disabled = state.isBusy || !canUnmute;
    dom.stopButton.disabled = state.isBusy || !canStop;
    dom.exportButton.disabled = state.isBusy || !hasSession || state.session.status !== "stopped";
    dom.clearStoppedSessionsButton.disabled = state.isBusy || !state.recentSessions.some((session) => session.status === "stopped");
    dom.markAllPresentButton.disabled = state.isBusy || state.attendees.length === 0;
    dom.muteButton.innerHTML = `${getMicOffIconMarkup()}<span>Mute</span>`;
    dom.unmuteButton.innerHTML = `${getMicIconMarkup()}<span>Unmute</span>`;
  }

  function getMicIconMarkup() {
    return `
      <svg class="button-icon" aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
        <line x1="12" x2="12" y1="19" y2="22"></line>
      </svg>
    `;
  }

  function getMicOffIconMarkup() {
    return `
      <svg class="button-icon" aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 2a3 3 0 0 0-3 3v5"></path>
        <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"></path>
        <path d="M19 10v2a7 7 0 0 1-.78 3.22"></path>
        <path d="M5 10v2a7 7 0 0 0 11.9 4.95"></path>
        <line x1="12" x2="12" y1="19" y2="22"></line>
        <line x1="2" x2="22" y1="2" y2="22"></line>
      </svg>
    `;
  }

  function getGripIconMarkup() {
    return `
      <svg class="button-icon" aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="9" cy="6" r="1"></circle>
        <circle cx="15" cy="6" r="1"></circle>
        <circle cx="9" cy="12" r="1"></circle>
        <circle cx="15" cy="12" r="1"></circle>
        <circle cx="9" cy="18" r="1"></circle>
        <circle cx="15" cy="18" r="1"></circle>
      </svg>
    `;
  }

  function getUsersIconMarkup(className = "button-icon") {
    return `
      <svg class="${escapeAttribute(className)}" aria-hidden="true" viewBox="0 0 24 24">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
        <path d="M16 3.128a4 4 0 0 1 0 7.744"></path>
        <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
        <circle cx="9" cy="7" r="4"></circle>
      </svg>
    `;
  }

  function renderAttendees() {
    dom.attendeeList.innerHTML = "";
    dom.speakerSuggestions.innerHTML = "";
    const sortedAttendees = getSortedAttendeesForDisplay();
    dom.markAllPresentButton.disabled = state.isBusy || sortedAttendees.length === 0;
    if (sortedAttendees.length === 0) {
      const item = document.createElement("li");
      item.className = "speaker-list-empty";
      item.innerHTML = `
        <strong>No speakers added</strong>
        <span>Upload a CSV of speakers before starting. You can still add names here later.</span>
      `;
      dom.attendeeList.append(item);
      return;
    }

    sortedAttendees.forEach((attendee) => {
      const item = document.createElement("li");
      if (isManualAttendee(attendee)) {
        item.classList.add("speaker-list-item-new");
      }
      const details = document.createElement("div");
      details.className = "speaker-list-details";

      const name = document.createElement("span");
      name.className = "speaker-list-name";
      name.textContent = getSpeakerDisplayName(attendee);
      details.append(name);
      const aliases = getAttendeeAliases(attendee);
      if (aliases.length > 0) {
        const aliasText = document.createElement("span");
        aliasText.className = "speaker-list-alias";
        aliasText.textContent = aliases.map(formatAliasForDisplay).join(", ");
        details.append(aliasText);
      }

      const status = getAttendanceStatus(attendee);
      const actions = document.createElement("div");
      actions.className = "speaker-list-actions";

      const controls = document.createElement("div");
      controls.className = "attendance-toggle";
      controls.setAttribute("aria-label", `${attendee.name} attendance`);
      controls.innerHTML = `
        <button
          type="button"
          data-action="set-attendance"
          data-attendee-id="${escapeAttribute(attendee.id)}"
          data-attendance-status="present"
          aria-pressed="${status === "present"}"
        >Present</button>
        <button
          type="button"
          data-action="set-attendance"
          data-attendee-id="${escapeAttribute(attendee.id)}"
          data-attendance-status="absent"
          aria-pressed="${status === "absent"}"
        >Absent</button>
      `;

      actions.append(controls);
      if (isManualAttendee(attendee)) {
        const deleteButton = document.createElement("button");
        deleteButton.className = "speaker-delete-button";
        deleteButton.type = "button";
        deleteButton.dataset.action = "delete-attendee";
        deleteButton.dataset.attendeeId = attendee.id;
        deleteButton.textContent = "Delete";
        actions.append(deleteButton);
      }

      item.append(details, actions);
      dom.attendeeList.append(item);

      const option = document.createElement("option");
      option.value = getSpeakerDisplayName(attendee);
      option.label = aliases.length > 0 ? aliases.map(formatAliasForDisplay).join(", ") : attendee.name;
      dom.speakerSuggestions.append(option);
    });
  }

  function renderRecentSessions() {
    if (!dom.recentSessions) {
      return;
    }
    dom.recentSessions.innerHTML = "";
    if (state.recentSessions.length === 0) {
      const placeholder = document.createElement("p");
      placeholder.className = "muted-text";
      placeholder.textContent = "No meetings are stored in IndexedDB yet.";
      dom.recentSessions.append(placeholder);
      dom.clearStoppedSessionsButton.disabled = true;
      return;
    }

    dom.clearStoppedSessionsButton.disabled = state.isBusy || !state.recentSessions.some((session) => session.status === "stopped");
    state.recentSessions.forEach((session) => {
      const summary = state.sessionSummaries.get(session.id) || {};
      const card = document.createElement("article");
      card.className = "recent-session-card";

      const heading = document.createElement("div");
      heading.innerHTML = `<strong>${escapeHtml(session.title || "Untitled session")}</strong>`;

      const meta = document.createElement("p");
      meta.className = "recent-session-meta";
      meta.textContent = `${formatAbsolute(session.updatedAt || session.startedAt)} | ${getStatusLabel(session)}`;

      const details = document.createElement("p");
      details.className = "recent-session-details";
      details.textContent = [
        `${summary.sectionCount || 0} sections`,
        `${summary.rowCount || 0} rows`,
        `${summary.audioSegmentCount || 0} WebM audio clips`,
        `${summary.audioChunkCount || 0} chunks`,
        formatBytes(summary.audioBytes || 0),
        `${summary.exportCount || 0} exports`,
      ].join(" | ");

      const actions = document.createElement("div");
      actions.className = "recent-session-actions";
      const loadButton = document.createElement("button");
      loadButton.type = "button";
      loadButton.dataset.action = "load-session";
      loadButton.dataset.sessionId = session.id;
      loadButton.textContent = state.session?.id === session.id ? "Loaded" : "Load";
      loadButton.disabled = state.session?.id === session.id || state.isBusy || isRecorderLive();
      actions.append(loadButton);

      const deleteButton = document.createElement("button");
      deleteButton.className = "danger-button";
      deleteButton.type = "button";
      deleteButton.dataset.action = "delete-session";
      deleteButton.dataset.sessionId = session.id;
      deleteButton.textContent = "Clear";
      deleteButton.disabled = state.isBusy || isRecorderLive() || session.status !== "stopped";
      actions.append(deleteButton);

      card.append(heading, meta, details, actions);
      dom.recentSessions.append(card);
    });
  }

  function renderRestoreBanner() {
    const shouldShow = Boolean(state.restoreBannerSessionId) && state.session?.id === state.restoreBannerSessionId;
    dom.restoreBanner.hidden = !shouldShow;
    if (!shouldShow || !state.session) {
      return;
    }

    const actionText = state.session.status === "muted" ? "resume in a fresh audio segment" : "continue in a fresh audio segment";
    dom.restoreBannerText.textContent = `“${state.session.title || "Untitled session"}” was reopened from IndexedDB. Its earlier audio is safe locally and recording can ${actionText}.`;
  }

  function renderSections() {
    dom.sectionsContainer.innerHTML = "";
    if (!state.session) {
      return;
    }
    const canDragSections = canReorderSections();

    if (isMinutesEntryLocked()) {
      const promptMarkup = speakerBankIsEmpty()
        ? `
        <div class="start-required-message speaker-required-message" id="startRequiredMessage" role="alert">
          ${getUsersIconMarkup("start-required-icon")}
          <span>Please click <button type="button" data-action="open-speakers">Speakers</button> and upload the CSV of speakers.</span>
        </div>
      `
        : `
        <div class="start-required-message" id="startRequiredMessage" role="alert">
          Click <button type="button" data-action="start-session">Start</button> before adding notes.
        </div>
      `;
      dom.sectionsContainer.insertAdjacentHTML("beforeend", `
        ${promptMarkup}
      `);
    }

    state.sections.forEach((section) => {
      const rows = state.rowsBySection.get(section.id) || [];
      const article = document.createElement("article");
      article.className = "section-card";
      article.dataset.sectionId = section.id;
      article.innerHTML = `
        <div class="section-topline">
          <button
            class="section-drag-handle"
            type="button"
            draggable="${canDragSections ? "true" : "false"}"
            data-section-drag-handle
            data-section-id="${escapeAttribute(section.id)}"
            aria-label="Move ${escapeAttribute(getDefaultSectionTitle(section))}"
            title="Move section"
            ${canDragSections ? "" : "disabled"}
          >
            ${getGripIconMarkup()}
          </button>
          <span class="section-kicker">Section ${section.order + 1}</span>
          <input class="section-title-input" data-field="section-title" data-section-id="${section.id}" value="${escapeAttribute(getSectionDisplayTitle(section))}" aria-label="Section title">
        </div>
        <div class="section-guide">
          <span>Speaker</span>
          <span>Notes</span>
          <span class="timestamp-guide">Timestamp</span>
        </div>
        <div class="rows-list" data-section-rows="${section.id}">
          ${rows.map((row) => createRowMarkup(section.id, row)).join("")}
        </div>
        <div class="section-footer">
          <button type="button" data-action="add-row" data-section-id="${section.id}">Add Row</button>
          <button class="ghost-button" type="button" data-action="add-section">Add Section</button>
        </div>
      `;
      dom.sectionsContainer.append(article);
    });

    dom.sectionsContainer.querySelectorAll("textarea").forEach(autoResizeTextarea);
  }

  function createRowMarkup(sectionId, row) {
    const locked = isMinutesEntryLocked();
    const lockAttributes = locked ? 'readonly aria-readonly="true" aria-describedby="startRequiredMessage"' : "";
    return `
      <div class="minute-row ${locked ? "minute-row-locked" : ""}" data-minute-row-id="${row.id}" data-row-elapsed-ms="${row.elapsedMs ?? ""}">
        <div class="speaker-cell">
          <input
            class="table-input"
            data-field="speaker"
            data-section-id="${sectionId}"
            data-row-id="${row.id}"
            value="${escapeAttribute(row.speaker || "")}"
            placeholder="Speaker"
            autocomplete="off"
            ${lockAttributes}
          >
          <div class="speaker-options" data-speaker-options-for="${row.id}" hidden></div>
        </div>
        <textarea
          class="table-textarea"
          data-field="notes"
          data-section-id="${sectionId}"
          data-row-id="${row.id}"
          placeholder="Type shorthand notes here"
          ${lockAttributes}
        >${escapeHtml(row.notes || "")}</textarea>
        <div class="timestamp-rail ${row.timestampLocked ? "" : "pending"}" data-timestamp-for="${row.id}">
          <span class="timestamp-chip">${escapeHtml(row.timestampLocked ? formatElapsed(row.elapsedMs) : "Pending")}</span>
        </div>
      </div>
    `;
  }

  function openPlaybackModal() {
    if (!state.session || state.session.status !== "stopped") {
      return;
    }
    renderPlaybackModal();
    dom.playbackModal.hidden = false;
    dom.playbackBackdrop.hidden = false;
    dom.closePlaybackButton.focus({ preventScroll: true });
  }

  function closePlaybackModal() {
    if (state.playbackAudio && !state.playbackAudio.paused) {
      state.playbackAudio.pause();
      clearPlaybackState();
    }
    dom.playbackModal.hidden = true;
    dom.playbackBackdrop.hidden = true;
  }

  function disposePlaybackAudio() {
    if (state.playbackAudio) {
      state.playbackAudio.pause();
      state.playbackAudio.removeEventListener("timeupdate", handlePlaybackTimeUpdate);
      state.playbackAudio.removeEventListener("ended", clearPlaybackState);
    }
    if (state.playbackUrl) {
      URL.revokeObjectURL(state.playbackUrl);
    }
    state.playbackAudio = null;
    state.playbackUrl = "";
    clearPlaybackState();
    dom.playbackModal.hidden = true;
    dom.playbackBackdrop.hidden = true;
  }

  function handlePlaybackModalClick(event) {
    const actionTarget = event.target.closest("[data-action]");
    if (!actionTarget) {
      return;
    }
    if (actionTarget.dataset.action === "play-section") {
      void toggleSectionPlayback(actionTarget.dataset.sectionId);
    }
  }

  function handleGlobalKeyDown(event) {
    if (event.key === "Escape" && !dom.playbackModal.hidden) {
      closePlaybackModal();
      return;
    }
    if (event.key === "Escape" && !dom.sessionsModal.hidden) {
      closeSessionsModal();
    }
  }

  function renderPlaybackModal() {
    if (!state.session || state.session.status !== "stopped") {
      dom.playbackSectionList.innerHTML = "";
      return;
    }

    dom.playbackSectionList.innerHTML = state.sections.map((section) => createPlaybackSectionMarkup(section)).join("");
    updatePlaybackControls();
    if (state.playbackAudio && state.playbackSectionId && !state.playbackAudio.paused) {
      updatePlaybackHighlights(state.playbackAudio.currentTime * 1000);
    }
  }

  function createPlaybackSectionMarkup(section) {
    const rows = (state.rowsBySection.get(section.id) || [])
      .filter((row) => hasRowContent(row) || row.timestampLocked);
    const isActive = state.playbackSectionId === section.id && state.playbackAudio && !state.playbackAudio.paused;
    const buttonLabel = isActive ? "Pause Section" : "Play Section";
    const rowMarkup = rows.length
      ? rows.map((row) => `
        <div class="playback-row" data-playback-row-id="${escapeAttribute(row.id)}">
          <span class="playback-row-speaker">${escapeHtml(row.speaker || "Speaker")}</span>
          <span>${escapeHtml(row.notes || "")}</span>
          <span class="playback-row-time">${escapeHtml(row.timestampLocked ? formatElapsed(row.elapsedMs) : "Pending")}</span>
        </div>
      `).join("")
      : '<p class="muted-text">No timed rows.</p>';

    return `
      <article class="playback-section-card" data-playback-section-id="${escapeAttribute(section.id)}">
        <div class="playback-section-heading">
          <h3>${escapeHtml(getSectionDisplayTitle(section))}</h3>
          <button
            class="playback-section-play-button ${isActive ? "active" : ""}"
            type="button"
            data-action="play-section"
            data-section-id="${escapeAttribute(section.id)}"
          >${buttonLabel}</button>
        </div>
        <div class="playback-row-list">
          ${rowMarkup}
        </div>
      </article>
    `;
  }

  async function toggleSectionPlayback(sectionId) {
    if (!state.session || state.session.status !== "stopped") {
      return;
    }

    if (state.playbackSectionId === sectionId && state.playbackAudio && !state.playbackAudio.paused) {
      pauseSectionPlayback();
      return;
    }

    const sectionIndex = state.sections.findIndex((section) => section.id === sectionId);
    if (sectionIndex < 0) {
      return;
    }

    const playbackRange = getSectionPlaybackRange(sectionIndex);
    if (playbackRange.endSeconds <= playbackRange.startSeconds) {
      window.alert("There is no recorded audio range for this section yet.");
      return;
    }

    try {
      const audio = await getPlaybackAudio();
      state.playbackSectionId = sectionId;
      state.playbackStopAtSeconds = playbackRange.endSeconds;
      audio.currentTime = playbackRange.startSeconds;
      await audio.play();
      updatePlaybackControls();
      updatePlaybackHighlights(audio.currentTime * 1000);
      setSaveState(`Playing ${getSectionDisplayTitle(state.sections[sectionIndex])}`);
    } catch (error) {
      console.error(error);
      setSaveState(`Playback failed: ${error.message}`);
      window.alert(`Playback failed: ${error.message}`);
    }
  }

  function pauseSectionPlayback() {
    if (state.playbackAudio) {
      state.playbackAudio.pause();
    }
    clearPlaybackState();
    setSaveState("Playback paused");
  }

  async function getPlaybackAudio() {
    if (state.playbackAudio && state.playbackUrl) {
      return state.playbackAudio;
    }

    const playbackBlob = await buildSessionPlaybackBlob(state.session.id);
    if (!playbackBlob) {
      throw new Error("No saved audio was found for this session.");
    }

    state.playbackUrl = URL.createObjectURL(playbackBlob);
    state.playbackAudio = new Audio(state.playbackUrl);
    state.playbackAudio.addEventListener("timeupdate", handlePlaybackTimeUpdate);
    state.playbackAudio.addEventListener("ended", clearPlaybackState);
    return state.playbackAudio;
  }

  async function buildSessionPlaybackBlob(sessionId) {
    const segments = (await getAllByIndex("audioSegments", "sessionId", sessionId))
      .sort((left, right) => left.segmentIndex - right.segmentIndex);
    const chunks = [];
    let mimeType = "";

    for (const segment of segments) {
      const segmentChunks = (await getAllByIndex("audioChunks", "segmentId", segment.id))
        .sort((left, right) => left.chunkIndex - right.chunkIndex);
      if (!mimeType && segment.mimeType) {
        mimeType = segment.mimeType;
      }
      segmentChunks.forEach((chunk) => chunks.push(chunk.blob));
    }

    if (chunks.length === 0) {
      return null;
    }
    return new Blob(chunks, { type: mimeType || "audio/webm" });
  }

  function handlePlaybackTimeUpdate() {
    if (!state.playbackAudio || !state.playbackSectionId) {
      return;
    }

    if (state.playbackStopAtSeconds && state.playbackAudio.currentTime >= state.playbackStopAtSeconds) {
      state.playbackAudio.pause();
      clearPlaybackState();
      setSaveState("Section playback complete");
      return;
    }

    updatePlaybackHighlights(state.playbackAudio.currentTime * 1000);
  }

  function clearPlaybackState() {
    state.playbackSectionId = null;
    state.playbackStopAtSeconds = null;
    updatePlaybackControls();
    updatePlaybackHighlights(null);
  }

  function updatePlaybackControls() {
    dom.playbackSectionList.querySelectorAll(".playback-section-play-button").forEach((button) => {
      const isActive = state.playbackSectionId === button.dataset.sectionId && state.playbackAudio && !state.playbackAudio.paused;
      button.classList.toggle("active", Boolean(isActive));
      button.textContent = isActive ? "Pause Section" : "Play Section";
    });
  }

  function updatePlaybackHighlights(elapsedMs) {
    dom.sectionsContainer.querySelectorAll(".minute-row.playback-active").forEach((rowElement) => {
      rowElement.classList.remove("playback-active");
    });
    dom.playbackSectionList.querySelectorAll(".playback-row.playback-active").forEach((rowElement) => {
      rowElement.classList.remove("playback-active");
    });

    if (!state.playbackSectionId || elapsedMs === null) {
      return;
    }

    const rows = state.rowsBySection.get(state.playbackSectionId) || [];
    const activeRow = [...rows]
      .filter((row) => row.timestampLocked && typeof row.elapsedMs === "number" && row.elapsedMs <= elapsedMs)
      .sort((left, right) => right.elapsedMs - left.elapsedMs)[0];
    if (!activeRow) {
      return;
    }

    const rowElement = dom.sectionsContainer.querySelector(`[data-minute-row-id="${activeRow.id}"]`);
    rowElement?.classList.add("playback-active");
    const playbackRowElement = dom.playbackSectionList.querySelector(`[data-playback-row-id="${activeRow.id}"]`);
    playbackRowElement?.classList.add("playback-active");
  }

  function getSectionPlaybackRange(sectionIndex) {
    const section = state.sections[sectionIndex];
    const nextSection = state.sections[sectionIndex + 1];
    const startMs = getSectionStartElapsedMs(section, sectionIndex);
    const endMs = typeof section.endedElapsedMs === "number"
      ? section.endedElapsedMs
      : (nextSection ? getSectionStartElapsedMs(nextSection, sectionIndex + 1) : getCurrentElapsedMs());
    return {
      startSeconds: Math.max(0, startMs / 1000),
      endSeconds: Math.max(startMs / 1000, endMs / 1000),
    };
  }

  function getSectionStartElapsedMs(section, sectionIndex) {
    if (typeof section.startedElapsedMs === "number") {
      const sectionCreatedBeforeRecording = sectionIndex > 0
        && section.startedElapsedMs === 0
        && section.startedAt
        && state.session?.startedAt
        && new Date(section.startedAt).getTime() < new Date(state.session.startedAt).getTime();
      if (sectionCreatedBeforeRecording) {
        const rows = state.rowsBySection.get(section.id) || [];
        const firstTimedRow = rows.find((row) => row.timestampLocked && typeof row.elapsedMs === "number");
        return firstTimedRow ? firstTimedRow.elapsedMs : 0;
      }
      return Math.max(0, section.startedElapsedMs);
    }
    if (sectionIndex === 0) {
      return 0;
    }
    const rows = state.rowsBySection.get(section.id) || [];
    const firstTimedRow = rows.find((row) => row.timestampLocked && typeof row.elapsedMs === "number");
    return firstTimedRow ? firstTimedRow.elapsedMs : 0;
  }

  function setSaveState(label) {
    state.currentSaveLabel = label;
    renderSaveState();
  }

  function renderSaveState() {
    const label = state.currentSaveLabel || "";
    dom.saveStateValue.textContent = label;
    dom.saveStateValue.hidden = !isActionableStatusLabel(label);
  }

  function isActionableStatusLabel(label) {
    return /(failed|failure|error|unavailable|unsupported|upload|select|click|run this app|initialization|speaker.*required|add speakers|mic test)/i.test(label || "");
  }

  function setBusy(isBusy) {
    state.isBusy = isBusy;
    renderButtons();
  }

  function isMinutesEntryLocked() {
    return Boolean(state.session && !state.session.startedAt);
  }

  function canReorderSections() {
    if (!state.session || state.sections.length < 2 || state.isBusy || isRecorderLive()) {
      return false;
    }
    if (state.playbackAudio && !state.playbackAudio.paused) {
      return false;
    }
    return state.session.status === "draft" || state.session.status === "stopped";
  }

  function currentSessionHasData() {
    if (!state.session) {
      return false;
    }
    if (state.session.startedAt || state.session.endedAt || state.session.status !== "draft") {
      return true;
    }
    if (hasCustomSessionTitle(state.session)) {
      return true;
    }
    ensureSessionAttendance(state.session);
    if (state.session.attendeeIds.length > 0 || Object.keys(state.session.attendanceByAttendeeId).length > 0) {
      return true;
    }
    if (state.sections.length > 1) {
      return true;
    }
    return state.sections.some((section) => {
      if (hasCustomSectionTitle(section)) {
        return true;
      }
      const rows = state.rowsBySection.get(section.id) || [];
      return rows.some((row) => row.timestampLocked || hasRowContent(row));
    });
  }

  function hasCustomSessionTitle(session) {
    const title = (session.title || "").trim();
    if (!title) {
      return false;
    }
    return !/^Meeting\s+\d{1,2}\/\d{1,2}\/\d{4},?\s+\d{1,2}:\d{2}\s*(AM|PM)?$/i.test(title);
  }

  function hasCustomSectionTitle(section) {
    const title = (section.title || "").trim();
    return Boolean(title) && title !== getDefaultSectionTitle(section);
  }

  function getDefaultSectionTitle(section) {
    return `Section ${section.order + 1}`;
  }

  function normalizeSectionTitleValue(section, value) {
    const title = String(value || "").trim();
    return title === getDefaultSectionTitle(section) ? "" : title;
  }

  function getSectionTitleInputValue(section) {
    const title = (section.title || "").trim();
    return title === getDefaultSectionTitle(section) ? "" : title;
  }

  function getSectionDisplayTitle(section) {
    return getSectionTitleInputValue(section) || getDefaultSectionTitle(section);
  }

  function isMinutesRowField(field) {
    return field === "speaker" || field === "notes";
  }

  function showStartRequiredError() {
    if (!isMinutesEntryLocked()) {
      return;
    }
    if (speakerBankIsEmpty()) {
      showSpeakersRequiredError();
      return;
    }

    hideSpeakerOptions();
    setSaveState("Click Start before adding notes");
    dom.speakerBankToggle.classList.remove("needs-attention");
    dom.startButton.classList.add("needs-attention");
    dom.startButton.focus({ preventScroll: true });

    if (state.startPromptTimer) {
      window.clearTimeout(state.startPromptTimer);
    }
    state.startPromptTimer = window.setTimeout(() => {
      dom.startButton.classList.remove("needs-attention");
      dom.speakerBankToggle.classList.remove("needs-attention");
      state.startPromptTimer = null;
    }, 1800);
  }

  function showSpeakersRequiredError() {
    hideSpeakerOptions();
    setSaveState("Upload speakers before starting");
    dom.startButton.classList.remove("needs-attention");
    dom.speakerBankToggle.classList.add("needs-attention");
    openSpeakerDrawer();

    if (state.startPromptTimer) {
      window.clearTimeout(state.startPromptTimer);
    }
    state.startPromptTimer = window.setTimeout(() => {
      dom.startButton.classList.remove("needs-attention");
      dom.speakerBankToggle.classList.remove("needs-attention");
      state.startPromptTimer = null;
    }, 1800);
  }

  function getDerivedSessionState() {
    if (!state.session) {
      return { label: "No session", isRecording: false };
    }
    if (isRecorderLive()) {
      return { label: "Recording", isRecording: true };
    }
    if (state.session.status === "muted") {
      return { label: "Muted", isRecording: false };
    }
    if (state.session.status === "recording") {
      return { label: "Recovered", isRecording: false };
    }
    return { label: getStatusLabel(state.session), isRecording: false };
  }

  function getStatusLabel(session) {
    const labels = {
      draft: "Draft",
      recording: "Recording",
      muted: "Muted",
      stopped: "Stopped",
    };
    return labels[session.status] || "Session";
  }

  function shouldShowRestoreBanner(session) {
    return ["recording", "muted"].includes(session.status);
  }

  function isRecorderLive() {
    return Boolean(state.mediaRecorder && state.mediaRecorder.state === "recording");
  }

  function renderSpeakerOptions(input) {
    if (!input || input.dataset.field !== "speaker") {
      return;
    }
    if (isMinutesEntryLocked()) {
      hideSpeakerOptions();
      return;
    }

    const options = getSpeakerOptionsElement(input);
    if (!options) {
      return;
    }

    hideSpeakerOptions(options);
    options.hidden = true;
    options.innerHTML = "";
    const query = input.value.trim();
    const matches = getSpeakerMatches(input.value);
    if (state.attendees.length === 0) {
      options.innerHTML = `
        <div class="speaker-option-empty">
          Add speakers in the Speakers panel first.
        </div>
      `;
      options.hidden = false;
      state.speakerSuggestionIndex = -1;
      return;
    }

    if (matches.length === 0) {
      options.innerHTML = `
        <div class="speaker-option-empty">
          No matching speaker. Add them in Speakers first.
        </div>
      `;
      options.hidden = false;
      state.speakerSuggestionIndex = -1;
      return;
    }

    options.innerHTML = matches.map((attendee, index) => {
      const aliases = getAttendeeAliases(attendee);
      const displayName = getSpeakerDisplayName(attendee);
      const aliasLabel = aliases.map(formatAliasForDisplay).join(", ");
      return `
        <button
          class="speaker-option"
          type="button"
          data-action="choose-speaker"
          data-section-id="${escapeAttribute(input.dataset.sectionId)}"
          data-row-id="${escapeAttribute(input.dataset.rowId)}"
          data-speaker-id="${escapeAttribute(attendee.id)}"
          data-speaker-name="${escapeAttribute(attendee.name)}"
          data-speaker-value="${escapeAttribute(displayName)}"
          aria-selected="${index === 0 ? "true" : "false"}"
        >
          <span class="speaker-option-name">${escapeHtml(displayName)}</span>
          ${aliasLabel ? `<span class="speaker-option-alias">${escapeHtml(aliasLabel)}</span>` : ""}
        </button>
      `;
    }).join("");
    options.hidden = false;
    state.speakerSuggestionIndex = query ? 0 : -1;
    if (!query) {
      setSpeakerSuggestionIndex(options, -1);
    }
  }

  function getSpeakerMatches(value) {
    const query = normalizeName(value);
    if (!query) {
      return getSortedAttendeesForDisplay().slice(0, 8);
    }
    return getSortedAttendeesForDisplay()
      .filter((attendee) => attendeeMatchesQuery(attendee, query))
      .slice(0, 8);
  }

  function attendeeMatchesQuery(attendee, query) {
    const compactQuery = compactSearchText(query);
    return getAttendeeSearchTerms(attendee).some((term) => {
      const normalizedTerm = normalizeName(term);
      return normalizedTerm.includes(query) || compactSearchText(normalizedTerm).includes(compactQuery);
    });
  }

  function getExactSpeakerMatch(value) {
    const query = normalizeName(value);
    if (!query) {
      return null;
    }
    return state.attendees.find((attendee) => {
      return getAttendeeSearchTerms(attendee).some((term) => normalizeName(term) === query);
    }) || null;
  }

  function getAttendeeSearchTerms(attendee) {
    return [
      attendee.name,
      getSpeakerDisplayName(attendee),
      ...getAttendeeAliases(attendee),
    ].filter(Boolean);
  }

  function selectSpeakerOption(option, options = {}) {
    const input = findRowField(option.dataset.sectionId, option.dataset.rowId, "speaker");
    if (!input) {
      return;
    }
    selectSpeakerValue(input, option.dataset.speakerValue, option.dataset.speakerId, options);
  }

  function selectSpeakerValue(input, value, attendeeId, options = {}) {
    input.value = value || "";
    input.classList.remove("speaker-input-error");
    input.removeAttribute("aria-invalid");
    if (input.value.trim()) {
      lockSpeakerInputTimestamp(input);
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    if (attendeeId) {
      void markAttendeePresent(attendeeId);
    }
    hideSpeakerOptions();
    if (options.moveToNotes) {
      focusRowNotes(input.dataset.sectionId, input.dataset.rowId);
    }
  }

  function commitSpeakerInput(input, options = {}) {
    const value = input.value.trim();
    if (!value) {
      input.classList.remove("speaker-input-error");
      input.removeAttribute("aria-invalid");
      hideSpeakerOptions();
      return;
    }

    const match = getExactSpeakerMatch(value);
    if (match) {
      selectSpeakerValue(input, getSpeakerDisplayName(match), match.id, options);
      return;
    }

    showSpeakerSelectionRequired(input);
  }

  async function markAttendeePresent(attendeeId) {
    const attendee = state.attendees.find((item) => item.id === attendeeId);
    if (!attendee) {
      return;
    }
    attendee.lastUsedAt = new Date().toISOString();
    await putRecord("attendees", attendee);
    await setAttendanceStatus(attendee.id, "present");
  }

  function showSpeakerSelectionRequired(input) {
    input.classList.add("speaker-input-error");
    input.setAttribute("aria-invalid", "true");
    setSaveState("Select a speaker from the list or add them in Speakers first");
    renderSpeakerOptions(input);
    window.requestAnimationFrame(() => input.focus());
  }

  function getSpeakerOptionsElement(input) {
    return input.closest(".speaker-cell")?.querySelector(`[data-speaker-options-for="${input.dataset.rowId}"]`);
  }

  function hideSpeakerOptions(exceptOptions) {
    dom.sectionsContainer.querySelectorAll(".speaker-options").forEach((options) => {
      if (options === exceptOptions) {
        return;
      }
      options.hidden = true;
      options.innerHTML = "";
    });
    state.speakerSuggestionIndex = -1;
  }

  function setSpeakerSuggestionIndex(options, index) {
    const optionButtons = [...options.querySelectorAll(".speaker-option")];
    state.speakerSuggestionIndex = index;
    optionButtons.forEach((button, buttonIndex) => {
      button.setAttribute("aria-selected", String(buttonIndex === index));
    });
  }

  function findRowField(sectionId, rowId, field) {
    return [...dom.sectionsContainer.querySelectorAll(`[data-field="${field}"]`)]
      .find((item) => item.dataset.sectionId === sectionId && item.dataset.rowId === rowId);
  }

  function focusRowNotes(sectionId, rowId) {
    const notes = findRowField(sectionId, rowId, "notes");
    notes?.focus();
  }

  function getAttendeeAliases(attendee) {
    return normalizeAliasList(attendee.aliases || []);
  }

  function getSpeakerDisplayName(attendee) {
    const aliases = getAttendeeAliases(attendee);
    if (aliases.length === 0) {
      return attendee.name;
    }
    return `${attendee.name} · ${formatAliasForDisplay(aliases[0])}`;
  }

  function splitAliases(value) {
    return String(value || "")
      .split(/[;,|/]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function normalizeAliasList(aliases) {
    return mergeUniqueStrings([], aliases
      .map((alias) => String(alias || "").trim())
      .filter(Boolean));
  }

  function mergeUniqueStrings(left, right) {
    const result = [];
    const seen = new Set();
    [...left, ...right].forEach((value) => {
      const trimmed = String(value || "").trim();
      const key = normalizeName(trimmed);
      if (!trimmed || seen.has(key)) {
        return;
      }
      seen.add(key);
      result.push(trimmed);
    });
    return result;
  }

  function formatAliasForDisplay(alias) {
    return String(alias || "").trim().replace(/\s+/g, "").toUpperCase();
  }

  function compactSearchText(value) {
    return String(value || "").replace(/[\s.·]+/g, "");
  }

  function autoResizeTextarea(textarea) {
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  function isCaretOnLastTextLine(textarea) {
    if (textarea.selectionStart !== textarea.selectionEnd) {
      return false;
    }

    const value = textarea.value || "";
    const caretIndex = textarea.selectionStart || 0;
    return !value.slice(caretIndex).includes("\n");
  }

  function focusFirstEditableRow(sectionId) {
    window.requestAnimationFrame(() => {
      if (isMinutesEntryLocked()) {
        dom.startButton.focus({ preventScroll: true });
        return;
      }
      const speakerFields = [...dom.sectionsContainer.querySelectorAll('[data-field="speaker"]')];
      const field = sectionId
        ? speakerFields.find((item) => item.dataset.sectionId === sectionId)
        : speakerFields[0];
      field?.focus();
    });
  }

  function hasRowContent(row) {
    return Boolean((row.speaker || "").trim() || (row.notes || "").trim());
  }

  function createId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeName(name) {
    return name.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function buildDefaultSessionTitle() {
    const now = new Date();
    return `Meeting ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }

  function formatElapsed(milliseconds) {
    if (!milliseconds && milliseconds !== 0) {
      return "00:00:00";
    }
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  }

  function formatAbsolute(isoValue) {
    if (!isoValue) {
      return "Not recorded";
    }
    const date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) {
      return "Not recorded";
    }
    return date.toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function formatBytes(bytes) {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  function sanitizeFileName(value) {
    return String(value || "minutes")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "minutes";
  }

  function getSelectedAudioLabel() {
    const selectedOption = dom.audioSourceSelect.selectedOptions[0];
    return selectedOption ? selectedOption.textContent : "Default microphone";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }

  function cssEscape(value) {
    if (window.CSS?.escape) {
      return window.CSS.escape(String(value || ""));
    }
    return String(value || "").replace(/["\\]/g, "\\$&");
  }
}());
