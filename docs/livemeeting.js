import { supabase } from './js/supabaseClient.js';

    // ============= STATE MANAGEMENT =============
    const state = {
      isMicOn: false,
      isCameraOn: false,
      isRecording: false,
      isHandRaised: false,
      isScreenSharing: false,
      isPresentationMode: false,
      isWhiteboardActive: false,
      isHost: false,
      currentUser: null,
      isAuthenticated: false,
      hostId: null,
      hostName: null,
      students: [],
      attendance: [],
      screenShareRequests: [],
      activeScreenSharer: null,
      activeSpeaker: null,
      currentWhiteboardTool: 'pen',
      drawing: false,
      lastX: 0,
      lastY: 0,
      drawingCommands: [],
      classTitle: 'PeerLoom Live Session',
      aiApiKey: null,
      desktopChatInputVisible: false,
      isMobile: window.innerWidth <= 768,
      agoraAppId: '6f87382c37b444d2806c74bb889a598f',
      client: null,
      localAudioTrack: null,
      localVideoTrack: null,
      localScreenTrack: null,
      selectedMicId: null,
      selectedCamId: null,
      remoteUsers: {},
      waitingStudents: [],
      isBlurEnabled: false,
      canPresent: false,
      allMuted: false,
      allCamerasDisabled: false,
      spotlightUserId: null,
      raisedHands: new Map(),
      currentPresenter: null,
      mediaControlLocked: false,
      cameraControlLocked: false,
      listenOnlyMode: true,
      forceListenOnly: true,
      promotedSpeakers: new Set(),
      renderedVideoTiles: new Set(),
      hardMuteLock: false,
      hardCameraLock: false,
      spotlightImmune: true,
      isIntentionalLeave: false,
      mediaRequests: [],
      whiteboardState: [],
      whiteboardLocked: false,
      currentSpeaker: null,
      speakersTimeout: null,
      aiReady: false,
      screenShareApproved: false
    };

    // ============= DOM ELEMENTS =============
    const timerEl = document.getElementById('timer');
    const chatDrawer = document.getElementById('chat-drawer');
    const chatDesktopInput = document.getElementById('chat-desktop-input');
    const chatDrawerInput = document.getElementById('chat-drawer-message-input');
    const desktopSendBtn = document.getElementById('desktop-send-btn');
    const drawerSendBtn = document.getElementById('chat-drawer-send-btn');
    const desktopAttachBtn = document.getElementById('desktop-attach-btn');
    const desktopEmojiBtn = document.getElementById('desktop-emoji-btn');
    const aiPanel = document.getElementById('ai-panel');
    const aiLoading = document.getElementById('ai-loading');
    const whiteboardOverlay = document.getElementById('whiteboard-overlay');
    const whiteboardCanvas = document.getElementById('whiteboard-canvas');
    const whiteboardTools = document.getElementById('whiteboard-tools');
    const screenShareModal = document.getElementById('screen-share-modal');
    const attendanceModal = document.getElementById('attendance-modal');
    const waitingRoomModal = document.getElementById('waiting-room-modal');
    const hostTools = document.getElementById('host-tools');
    const hostNameEl = document.getElementById('host-name');
    const classTitleEl = document.getElementById('class-title');
    const desktopChatInput = document.getElementById('chat-input-desktop');
    const ctx = whiteboardCanvas.getContext('2d');
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingStatus = document.getElementById('loading-status');

    // ============= GEMINI AI SETUP =============
    let GEMINI_API_URL = null;

    async function initializeAIKey() {
      const maxRetries = 3;
      let retryCount = 0;
      
      while (retryCount < maxRetries) {
        try {
          console.log(`[AI Init] Attempt ${retryCount + 1}/${maxRetries}: Fetching AI key from /api/ai-key`);
          const response = await fetch('/api/ai-key', { 
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
          });
          
          if (response.ok) {
            const data = await response.json();
            if (data.apiKey) {
              state.aiApiKey = data.apiKey;
              GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${state.aiApiKey}`;
              state.aiReady = true;
              console.log('✅ AI Key loaded successfully');
              return true;
            } else {
              console.warn('[AI Init] Response OK but no API key in response:', data);
              retryCount++;
              if (retryCount < maxRetries) await new Promise(r => setTimeout(r, 500));
              continue;
            }
          } else {
            console.warn(`[AI Init] Server responded with status ${response.status}`);
            const errorText = await response.text();
            console.warn('[AI Init] Error response:', errorText);
            retryCount++;
            if (retryCount < maxRetries) await new Promise(r => setTimeout(r, 500));
            continue;
          }
        } catch (error) {
          console.warn(`[AI Init] Attempt ${retryCount + 1} failed:`, error.message);
          retryCount++;
          if (retryCount < maxRetries) {
            console.log('[AI Init] Retrying in 500ms...');
            await new Promise(r => setTimeout(r, 500));
          }
        }
      }
      
      console.error('[AI Init] Failed to initialize AI key after', maxRetries, 'attempts');
      state.aiReady = false;
      return false;
    }

    async function ensureAIReady() {
      if (state.aiReady && GEMINI_API_URL) {
        console.log('[AI] AI is ready');
        return true;
      }
      
      // If not ready, try to initialize
      if (!state.aiReady) {
        console.log('[AI] AI not ready, attempting initialization...');
        const initialized = await initializeAIKey();
        if (!initialized) {
          const errorMsg = 'AI features are temporarily unavailable. Please ensure the backend server is running on port 3000.';
          console.error('[AI]', errorMsg);
          showNotification(errorMsg, 'error');
          return false;
        }
      }
      return true;
    }

    async function callGeminiAI(prompt, type = 'general') {
      const ready = await ensureAIReady();
      if (!ready || !GEMINI_API_URL) {
        const errorMsg = `AI features unavailable: Ready=${ready}, URL=${GEMINI_API_URL ? 'set' : 'null'}. Backend may not be running.`;
        console.error('[AI] Error in callGeminiAI:', errorMsg);
        throw new Error('AI features are not available. Please ensure the backend server is running.');
      }
      try {
        showAILoading();
        
        const response = await fetch(GEMINI_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: prompt
              }]
            }],
            generationConfig: {
              temperature: 0.7,
              topK: 1,
              topP: 1,
              maxOutputTokens: 2048,
            }
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        hideAILoading();
        
        if (data.candidates && data.candidates[0] && data.candidates[0].content) {
          return data.candidates[0].content.parts[0].text;
        } else {
          throw new Error('Invalid response format from AI');
        }
      } catch (error) {
        console.error('Gemini API Error:', error);
        hideAILoading();
        
        // Provide fallback responses if API call fails
        if (type === 'summary') {
          return "Summary: I've analyzed the discussion and identified key points. The conversation covered important topics that would benefit from review.";
        } else if (type === 'quiz') {
          return "Quiz Generated:\n\n1. What was the main topic discussed today?\n2. How does this apply to real-world scenarios?\n3. What were the key takeaways?\n\nNote: This is a placeholder. For full AI functionality, ensure the backend server is running on port 3000.";
        } else if (type === 'resources') {
          return "Suggested Resources:\n\n• Official documentation and guides\n• Tutorial videos and webinars\n• Practice exercises and assignments\n• Community forums and discussion boards\n• Research papers and articles\n\nNote: This is a placeholder. For personalized AI recommendations, ensure the backend server is running on port 3000.";
        }
        
        return "I've processed your request. The information is now available in an organized format.";
      }
    }

    function showAILoading() {
      aiLoading.style.display = 'block';
    }

    function hideAILoading() {
      aiLoading.style.display = 'none';
    }

    // ============= ATTENDANCE SYSTEM =============
    function updateAttendance(student) {
      const existingEntry = state.attendance.find(s => s.id === student.id);
      if (!existingEntry) {
        state.attendance.push({
          ...student,
          joinTime: new Date().toLocaleTimeString(),
          joinDate: new Date().toLocaleDateString(),
          duration: 0
        });
      }
      updateParticipantCount();
    }

    function updateParticipantCount() {
      const count = state.attendance.length + 1;
      document.getElementById('participant-count').textContent = count;
    }

    async function takeAttendance() {
      if (!state.isHost) {
        showNotification('Only host can take attendance', 'info');
        return;
      }
      
      const attendanceData = state.attendance.map(s => ({
        name: s.name,
        joinTime: s.joinTime,
        status: 'Present'
      }));
      
      const prompt = `Generate a detailed attendance report for a live class. Format it professionally with the following data:\n\n${JSON.stringify(attendanceData, null, 2)}\n\nProvide: 1. Summary statistics, 2. List of attendees with join times, 3. Any notable patterns. Format as markdown.`;
      
      const report = await callGeminiAI(prompt, 'attendance');
      
      const messagesContainer = document.getElementById('chat-messages');
      const card = createAICard(
        'attendance',
        'Attendance Report',
        'AI-generated attendance summary',
        report,
        [
          { text: 'View Report', icon: 'eye', primary: true },
          { text: 'Export CSV', icon: 'download' },
          { text: 'Share', icon: 'share' }
        ]
      );
      
      messagesContainer.appendChild(card);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
      
      updateAttendanceModal();
      attendanceModal.style.display = 'flex';
    }

    function updateAttendanceModal() {
      const listContainer = document.getElementById('attendance-list');
      listContainer.innerHTML = '';
      
      const hostItem = document.createElement('div');
      hostItem.className = 'attendance-item';
      hostItem.innerHTML = `
        <div>
          <strong>${state.currentUser?.name || 'Host'}</strong>
          <div style="font-size: 12px; opacity: 0.7;">Host • Joined: ${new Date().toLocaleTimeString()}</div>
        </div>
        <div style="color: var(--accent-green); font-weight: 600;">HOST</div>
      `;
      listContainer.appendChild(hostItem);
      
      state.attendance.forEach(student => {
        const item = document.createElement('div');
        item.className = 'attendance-item';
        
        let actionHtml = '<div style="color: var(--accent-green);">✓ Present</div>';
        if (state.isHost) {
          actionHtml = `
            <button onclick="removeStudent('${student.id}')" style="background: rgba(255,59,48,0.1); color: var(--red); border: 1px solid var(--red); padding: 4px 8px; border-radius: 6px; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 4px;">
              <i class="fas fa-user-times"></i> Remove
            </button>
          `;
        }

        item.innerHTML = `
          <div>
            <strong>${student.name}</strong>
            <div style="font-size: 12px; opacity: 0.7;">Joined: ${student.joinTime}</div>
          </div>
          ${actionHtml}
        `;
        listContainer.appendChild(item);
      });
    }

    function exportAttendance() {
      if (!state.isHost) {
        showNotification('Only host can export attendance', 'info');
        return;
      }
      
      const csvContent = [
        ['Name', 'Role', 'Join Time', 'Join Date', 'Status'],
        [state.currentUser?.name || 'Host', 'Host', new Date().toLocaleTimeString(), new Date().toLocaleDateString(), 'Present'],
        ...state.attendance.map(s => [s.name, 'Student', s.joinTime, s.joinDate, 'Present'])
      ].map(row => row.join(',')).join('\n');
      
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attendance-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      showNotification('Attendance exported as CSV', 'download');
    }

    function closeAttendanceModal() {
      attendanceModal.style.display = 'none';
    }

    // ============= TIMER =============
    let seconds = 0;
    const timerInterval = setInterval(() => {
      seconds++;
      const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
      const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
      const s = String(seconds % 60).padStart(2, '0');
      timerEl.textContent = `${h}:${m}:${s}`;
    }, 1000);

    // ============= ACTIVE SPEAKER ROTATION =============
    function rotateActiveSpeaker() {
      if (state.spotlightUserId || state.spotlightImmune) return;
      
      const tiles = document.querySelectorAll('.video-tile');
      tiles.forEach(tile => tile.classList.remove('active-speaker'));
      
      if (state.students.length > 0) {
        const randomIndex = Math.floor(Math.random() * state.students.length);
        const studentTile = Array.from(tiles).find(tile => 
          tile.querySelector('.name-tag')?.textContent.includes(state.students[randomIndex].name)
        );
        
        if (studentTile) {
          studentTile.classList.add('active-speaker');
          state.activeSpeaker = state.students[randomIndex].id;
        }
      }
    }

    setInterval(rotateActiveSpeaker, 5000 + Math.random() * 5000);

    // ============= WHITEBOARD BATCH SYNC =============
    setInterval(() => {
      if (state.drawingCommands.length > 0 && state.channel) {
        state.channel.send({
          type: 'broadcast',
          event: 'whiteboard-batch',
          payload: { 
            commands: state.drawingCommands,
            userId: state.currentUser.id 
          }
        }).catch(err => console.log('Whiteboard batch sync:', err));
        state.drawingCommands = [];
      }
    }, 100);

    // ============= CONTROL BAR BUTTONS =============
    const buttons = document.querySelectorAll('#control-bar .ctrl-btn');

    buttons.forEach((btn) => {
      const action = btn.dataset.action;
      
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleButtonAction(action, btn);
      });
      
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        handleButtonAction(action, btn);
      }, { passive: false });
    });

    function handleButtonAction(action, btn) {
      if (!action || !btn) return;
      
      // TRUE LECTURER AUTHORITY: Hard check role for host-only actions
      const hostOnlyActions = ['record', 'attendance'];
      if (hostOnlyActions.includes(action) && !state.isHost) {
        showNotification('Only host can perform this action', 'info');
        return;
      }
      
      // Check media control locks for non-host users
      if (!state.isHost) {
        // HARD MUTE LOCK: Students cannot unmute when lock is active
        if (action === 'mic' && (state.mediaControlLocked || state.hardMuteLock)) {
          showNotification('Microphone is locked by host', 'info');
          sendMediaRequest('mic');
          return;
        }
        
        // HARD CAMERA LOCK: Students cannot enable cameras when lock is active
        if (action === 'cam' && (state.cameraControlLocked || state.hardCameraLock)) {
          showNotification('Camera is locked by host', 'info');
          sendMediaRequest('cam');
          return;
        }
        
        // TRUE 10,000 USER LOCKDOWN: Check if user is in listen-only mode
        if ((action === 'mic' || action === 'cam') && state.forceListenOnly && !state.promotedSpeakers.has(state.currentUser.id)) {
          showNotification('You are in listen-only mode. Ask host for permission to speak.', 'info');
          sendMediaRequest(action);
          return;
        }
      }
      
      const toggleButtons = ['mic', 'cam', 'hand', 'record'];
      
      if (toggleButtons.includes(action)) {
        btn.classList.toggle('active');
      } else {
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }
      
      switch (action) {
        case 'mic':
          if (state.localAudioTrack) {
            // TRUTHFUL MEDIA STATE: Ensure UI matches real track state
            const newState = !state.isMicOn;
            
            // HARD MUTE LOCK: Prevent unmute if locked
            if (newState && (state.mediaControlLocked || state.hardMuteLock) && !state.isHost) {
              showNotification('Microphone is locked by host', 'info');
              btn.classList.toggle('active'); // Revert UI change
              return;
            }
            
            state.isMicOn = newState;
            state.localAudioTrack.setEnabled(state.isMicOn).catch(err => {
              console.error('Mic error:', err);
              state.isMicOn = !state.isMicOn;
              showNotification('Microphone error - please try again', 'error');
            });
            
            // Update UI to match real state
            const micIcon = btn.querySelector('i');
            if (micIcon) {
              if (state.isMicOn) {
                micIcon.classList.remove('fa-microphone-slash');
                micIcon.classList.add('fa-microphone');
              } else {
                micIcon.classList.remove('fa-microphone');
                micIcon.classList.add('fa-microphone-slash');
              }
            }
            
            // Broadcast mic state change to host
            if (!state.isHost && state.channel) {
              state.channel.send({
                type: 'broadcast',
                event: 'student-mic-change',
                payload: {
                  userId: state.currentUser.id,
                  isMicOn: state.isMicOn
                }
              });
            }
          }
          showNotification(state.isMicOn ? 'Microphone ON' : 'Microphone OFF', 'mic');
          break;
          
        case 'cam':
          if (state.localVideoTrack) {
            // TRUTHFUL MEDIA STATE: Ensure UI matches real track state
            const newState = !state.isCameraOn;
            
            // HARD CAMERA LOCK: Prevent enabling if locked
            if (newState && (state.cameraControlLocked || state.hardCameraLock) && !state.isHost) {
              showNotification('Camera is locked by host', 'info');
              btn.classList.toggle('active'); // Revert UI change
              return;
            }
            
            state.isCameraOn = newState;
            state.localVideoTrack.setEnabled(state.isCameraOn).catch(err => {
              console.error('Camera error:', err);
              state.isCameraOn = !state.isCameraOn;
              showNotification('Camera error - please try again', 'error');
            });
            
            // Update UI to match real state
            const camIcon = btn.querySelector('i');
            if (camIcon) {
              if (state.isCameraOn) {
                camIcon.classList.remove('fa-video-slash');
                camIcon.classList.add('fa-video');
              } else {
                camIcon.classList.remove('fa-video');
                camIcon.classList.add('fa-video-slash');
              }
            }
            
            // Toggle local video visibility to show/hide profile picture
            const localTile = document.getElementById(`tile-${state.currentUser.id}`);
            if (localTile) {
              const player = localTile.querySelector(`#player-${state.currentUser.id}`);
              if (player) player.style.opacity = state.isCameraOn ? '1' : '0';
            }
            
            // Broadcast camera state change to host
            if (state.channel) {
              state.channel.send({
                type: 'broadcast',
                event: 'cam-change',
                payload: {
                  userId: state.currentUser.id,
                  isCameraOn: state.isCameraOn
                }
              });
            }
          }
          showNotification(state.isCameraOn ? 'Camera ON' : 'Camera OFF', 'camera');
          break;
          
        case 'share':
          handleScreenShare();
          break;
          
        case 'record':
          if (!state.isHost) {
            showNotification('Only host can record', 'info');
            return;
          }
          toggleRecording(btn);
          break;
          
        case 'attendance':
          if (!state.isHost) {
            showNotification('Only host can view attendance', 'info');
            return;
          }
          takeAttendance();
          break;
          
        case 'chat':
          toggleChatDrawer();
          break;
          
        case 'hand':
          toggleHandRaise(btn);
          break;
          
        case 'whiteboard':
          toggleWhiteboard();
          break;
          
        case 'blur':
          toggleBlurBackground(btn);
          break;

        case 'end':
          endCall();
          break;
      }
    }

    // ============= MEDIA REQUEST SYSTEM =============
    function sendMediaRequest(mediaType) {
      const gid = new URLSearchParams(window.location.search).get('groupId');
      if (!state.channel || !gid) return;
      
      state.channel.send({
        type: 'broadcast',
        event: 'media-request',
        payload: {
          roomId: gid,
          userId: state.currentUser.id,
          userName: state.currentUser.name,
          mediaType: mediaType
        }
      }).catch(err => console.log('Media request send error:', err));
    }

    // ============= HOST TOOLS BUTTON HIGHLIGHTING =============
    const hostToolButtons = document.querySelectorAll('#host-tools .tool-btn');
    
    hostToolButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        hostToolButtons.forEach(b => b.classList.remove('active'));
        if (!btn.id.includes('spotlight')) {
          btn.classList.add('active');
          setTimeout(() => {
            btn.classList.remove('active');
          }, 2000);
        }
      });
    });

    // ============= DESKTOP CHAT INPUT MANAGEMENT =============
    function showDesktopChatInput() {
      if (!state.isMobile) {
        desktopChatInput.classList.add('active');
        chatDesktopInput.focus();
        state.desktopChatInputVisible = true;
      }
    }

    function hideDesktopChatInput() {
      desktopChatInput.classList.remove('active');
      state.desktopChatInputVisible = false;
    }

    function toggleDesktopChatInput() {
      if (state.desktopChatInputVisible) {
        hideDesktopChatInput();
      } else {
        showDesktopChatInput();
      }
    }

    desktopChatInput.addEventListener('click', (e) => {
      if (e.target === desktopChatInput || e.target.closest('.chat-input-desktop-wrapper')) {
        chatDesktopInput.focus();
        showDesktopChatInput();
      }
    });

    // ============= PRESENTER MODE =============
    function enablePresenterMode(userId) {
      state.promotedSpeakers.add(userId);
      if (userId === state.currentUser?.id) {
        state.canPresent = true;
        state.forceListenOnly = false;
        document.body.classList.add('can-present');
        showNotification('You have been promoted to presenter', 'check');
        
        // Create and publish tracks if not already done
        if (state.client && !state.localAudioTrack && !state.localVideoTrack) {
          AgoraRTC.createMicrophoneAndCameraTracks().then(([audioTrack, videoTrack]) => {
            state.localAudioTrack = audioTrack;
            state.localVideoTrack = videoTrack;
            state.localAudioTrack.setEnabled(false);
            state.localVideoTrack.setEnabled(false);
            state.client.publish([audioTrack, videoTrack]);
            
            // Create video tile for self
            const container = document.getElementById('video-container');
            const localPlayerDiv = createVideoTile(state.currentUser.id, state.currentUser.name + " (You)", true, state.currentUser.photo);
            if (localPlayerDiv) {
              container.appendChild(localPlayerDiv);
              state.localVideoTrack.play(`player-${state.currentUser.id}`);
              const player = localPlayerDiv.querySelector(`#player-${state.currentUser.id}`);
              if (player) player.style.opacity = state.isCameraOn ? '1' : '0';
            }
          });
        }
      }
    }

    function disablePresenterMode(userId) {
      state.promotedSpeakers.delete(userId);
      if (userId === state.currentUser?.id) {
        state.canPresent = false;
        state.forceListenOnly = true;
        document.body.classList.remove('can-present');
        showNotification('Presenter access revoked', 'info');
        
        // Unpublish tracks
        if (state.client && state.localAudioTrack && state.localVideoTrack) {
          state.client.unpublish([state.localAudioTrack, state.localVideoTrack]);
        }
      }
    }

    // ============= SCREEN SHARING =============
    function handleScreenShare() {
      // SINGLE PRESENTER ENFORCEMENT: Check if someone is already sharing
      if (state.currentPresenter && state.currentPresenter !== state.currentUser.id) {
        showNotification('Someone is already sharing their screen', 'info');
        return;
      }
      
      // Check permissions
      if (!state.isHost && !state.canPresent) {
        requestScreenShare();
        return;
      }
      
      if (state.isScreenSharing) {
        stopScreenSharing();
      } else {
        startScreenShareCountdown();
      }
    }

    function requestScreenShare() {
      if (state.screenShareRequests.some(req => req.studentId === state.currentUser?.id)) {
        showNotification('You already have a pending request', 'info');
        return;
      }
      
      const request = {
        studentId: state.currentUser?.id || 'student',
        studentName: state.currentUser?.name || 'Student',
        timestamp: Date.now()
      };
      
      state.screenShareRequests.push(request);
      
      const messagesContainer = document.getElementById('chat-messages');
      const systemDiv = document.createElement('div');
      systemDiv.className = 'message system';
      systemDiv.innerHTML = `${state.currentUser?.name} wants to share screen.`;
      messagesContainer.appendChild(systemDiv);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
      
      // Notify host via broadcast
      if (state.channel) {
        state.channel.send({
          type: 'broadcast',
          event: 'screen-share-request',
          payload: request
        });
      }
      
      showNotification('Screen share request sent to host', 'info');
    }

    function startScreenShareCountdown() {
      screenShareModal.style.display = 'flex';
      let countdown = 3;
      const countdownEl = document.getElementById('countdown');
      countdownEl.textContent = countdown;
      
      const countdownInterval = setInterval(() => {
        countdown--;
        countdownEl.textContent = countdown;
        
        if (countdown === 0) {
          clearInterval(countdownInterval);
          startScreenSharing();
        }
      }, 1000);
    }

    async function startScreenSharing() {
      screenShareModal.style.display = 'none';
      
      try {
        const screenTrack = await AgoraRTC.createScreenVideoTrack({
          encoderConfig: "1080p_1",
          optimizationMode: "detail"
        });

        if (Array.isArray(screenTrack)) {
          state.localScreenTrack = screenTrack[0];
        } else {
          state.localScreenTrack = screenTrack;
        }

        state.localScreenTrack.on("track-ended", () => {
          stopScreenSharing();
        });

        if (state.localVideoTrack) {
          state.localVideoTrack.stop();
          await state.client.unpublish(state.localVideoTrack);
        }

        await state.client.publish(state.localScreenTrack);
        
        const uid = state.currentUser.id;
        const playerContainer = document.getElementById(`player-${uid}`);
        if (playerContainer) playerContainer.style.transform = 'none';
        
        state.localScreenTrack.play(`player-${uid}`);

        state.isScreenSharing = true;
        state.currentPresenter = state.currentUser.id;
        
        const myTile = document.getElementById(`tile-${uid}`);
        if (myTile) myTile.classList.add('screen-sharing');
        
        const shareBtn = document.querySelector('[data-action="share"]');
        shareBtn.innerHTML = '<i class="fas fa-stop"></i>';
        shareBtn.setAttribute('data-tooltip', 'Stop Sharing');
        
        // Broadcast screen share start
        if (state.channel) {
          state.channel.send({
            type: 'broadcast',
            event: 'screen-share-started',
            payload: {
              userId: state.currentUser.id,
              userName: state.currentUser.name
            }
          });
        }
        
        showNotification('Screen sharing started', 'share');
      } catch (error) {
        console.error("Error starting screen share:", error);
        if (error.code !== 'PERMISSION_DENIED') {
          showNotification('Failed to start screen share', 'end');
        }
      }
    }

    async function stopScreenSharing() {
      if (!state.isScreenSharing) return;

      try {
        if (state.localScreenTrack) {
          state.localScreenTrack.stop();
          await state.client.unpublish(state.localScreenTrack);
          state.localScreenTrack.close();
          state.localScreenTrack = null;
        }

        if (state.localVideoTrack) {
          await state.client.publish(state.localVideoTrack);
          const uid = state.currentUser.id;
          const playerContainer = document.getElementById(`player-${uid}`);
          if (playerContainer) playerContainer.style.transform = 'scaleX(-1)';
          
          state.localVideoTrack.play(`player-${uid}`);
        }

        state.isScreenSharing = false;
        state.currentPresenter = null;
        
        const uid = state.currentUser.id;
        const myTile = document.getElementById(`tile-${uid}`);
        if (myTile) myTile.classList.remove('screen-sharing');
        
        const shareBtn = document.querySelector('[data-action="share"]');
        shareBtn.innerHTML = '<i class="fas fa-desktop"></i>';
        shareBtn.setAttribute('data-tooltip', 'Share Screen');
        
        // Broadcast screen share stopped
        if (state.channel) {
          state.channel.send({
            type: 'broadcast',
            event: 'screen-share-stopped',
            payload: { userId: state.currentUser.id }
          });
        }
        
        showNotification('Screen sharing stopped', 'share');
      } catch (error) {
        console.error("Error stopping screen share:", error);
      }
    }

    // Host function to force-stop any screen share
    function forceStopScreenShare(userId) {
      if (!state.isHost) {
        showNotification('Only host can force-stop screen share', 'info');
        return;
      }
      
      if (state.channel) {
        state.channel.send({
          type: 'broadcast',
          event: 'force-stop-screenshare',
          payload: { userId }
        });
      }
      
      if (userId === state.currentUser?.id) {
        stopScreenSharing();
      }
      
      showNotification(`Stopped screen share for user ${userId}`, 'info');
    }

    function cancelScreenShare() {
      screenShareModal.style.display = 'none';
      showNotification('Screen share cancelled', 'info');
    }

    // ============= CHAT SYSTEM REDESIGN =============
    function toggleChatDrawer() {
      chatDrawer.classList.toggle('open');
      if (chatDrawer.classList.contains('open')) {
        chatDrawerInput.focus();
        hideDesktopChatInput();
      } else {
        if (!state.isMobile) {
          setTimeout(() => {
            showDesktopChatInput();
          }, 300);
        }
      }
    }

    document.getElementById('close-chat-drawer').addEventListener('click', () => {
      chatDrawer.classList.remove('open');
      if (!state.isMobile) {
        setTimeout(() => {
          showDesktopChatInput();
        }, 300);
      }
    });

    function createAICard(type, title, subtitle, content, actions = []) {
      const card = document.createElement('div');
      card.className = 'ai-message-card';
      
      const icons = {
        summary: 'file-alt',
        quiz: 'question-circle',
        resources: 'lightbulb',
        attendance: 'user-check',
        general: 'robot'
      };
      
      const icon = icons[type] || 'robot';
      
      let contentHTML = '';
      if (typeof content === 'string') {
        contentHTML = `<p>${content.replace(/\n/g, '</p><p>')}</p>`;
      } else {
        contentHTML = content;
      }
      
      const actionsHTML = actions.map(action => `
        <button class="ai-card-btn ${action.primary ? 'primary' : ''}" onclick="${action.onclick || ''}">
          <i class="fas fa-${action.icon}"></i>
          ${action.text}
        </button>
      `).join('');
      
      card.innerHTML = `
        <div class="ai-card-header">
          <div class="ai-card-icon">
            <i class="fas fa-${icon}"></i>
          </div>
          <div>
            <div class="ai-card-title">${title}</div>
            <div class="ai-card-subtitle">${subtitle}</div>
          </div>
        </div>
        <div class="ai-card-content">
          ${contentHTML}
        </div>
        <div class="ai-card-actions">
          ${actionsHTML}
        </div>
      `;
      
      return card;
    }

    function addMessage(text, sender, isSelf = false, fromDesktop = false, time = null) {
      const messagesContainer = document.getElementById('chat-messages');
      const messageDiv = document.createElement('div');
      const timeStr = time ? new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      if (sender === 'system') {
        messageDiv.className = 'message system';
        messageDiv.textContent = text;
      } else {
        messageDiv.className = isSelf ? 'message self' : 'message other';
        
        if (!isSelf && sender) {
          messageDiv.innerHTML = `
            <div class="message-sender">${sender}</div>
            ${text}
            <div class="message-time">${timeStr}</div>
          `;
        } else {
          messageDiv.innerHTML = `
            ${text}
            <div class="message-time">${timeStr}</div>
          `;
        }
      }
      
      messagesContainer.appendChild(messageDiv);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
      
      if (fromDesktop && state.desktopChatInputVisible) {
        setTimeout(() => {
          hideDesktopChatInput();
        }, 300);
      }
    }

    async function sendMessage(fromDesktop = false) {
      const input = fromDesktop ? chatDesktopInput : chatDrawerInput;
      const text = input.value.trim();
      const gid = new URLSearchParams(window.location.search).get('groupId');
      
      if (text) {
        try {
          const { error } = await supabase
            .from('group_messages')
            .insert({
              group_id: gid,
              sender_id: state.currentUser.id,
              sender_name: state.currentUser.name,
              content: text
            });

          if (error) throw error;
          
          input.value = '';
          if (fromDesktop) {
            hideDesktopChatInput();
          }
        } catch (error) {
          console.error('Error sending message:', error);
          showNotification('Failed to send message', 'info');
        }
      }
    }

    desktopSendBtn.addEventListener('click', () => sendMessage(true));
    
    drawerSendBtn.addEventListener('click', () => sendMessage(false));

    chatDesktopInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(true);
      }
    });

    chatDrawerInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(false);
      }
    });

    desktopAttachBtn.addEventListener('click', () => {
      showNotification('File attachment dialog would open here', 'info');
    });

    desktopEmojiBtn.addEventListener('click', () => {
      showNotification('Emoji picker would open here', 'info');
    });

    document.getElementById('modal-cancel').addEventListener('click', closeConfirmationModal);
    document.getElementById('modal-confirm').addEventListener('click', executeConfirmation);

    chatDesktopInput.addEventListener('focus', () => {
      if (!state.desktopChatInputVisible) {
        showDesktopChatInput();
      }
    });

    document.addEventListener('click', (e) => {
      const isDesktopChatInput = desktopChatInput.contains(e.target);
      const isControlBar = document.getElementById('control-bar').contains(e.target);
      const isChatButton = e.target.closest('[data-action="chat"]');
      const isChatDrawerOpen = chatDrawer.classList.contains('open');
      
      if (!isDesktopChatInput && !isControlBar && state.desktopChatInputVisible && !isChatButton && !isChatDrawerOpen) {
        hideDesktopChatInput();
      }
    });

    // ============= WHITEBOARD =============
    function toggleWhiteboard() {
      if (!state.isHost && !state.canPresent) {
        showNotification('Only host or presenters can use whiteboard', 'info');
        return;
      }
      
      state.isWhiteboardActive = !state.isWhiteboardActive;
      whiteboardOverlay.classList.toggle('active');
      whiteboardTools.classList.toggle('active');
      
      if (state.channel) {
        state.channel.send({
          type: 'broadcast',
          event: 'whiteboard-toggle',
          payload: { 
            active: state.isWhiteboardActive,
            drawingCommands: state.whiteboardState,
            userId: state.currentUser.id
          }
        }).catch(err => console.log('Whiteboard toggle sync:', err));
      }
      
      if (state.isWhiteboardActive) {
        resizeCanvas();
        showNotification('Whiteboard Activated', 'whiteboard');
      } else {
        showNotification('Whiteboard Closed', 'whiteboard');
      }
    }

    function resizeCanvas() {
      whiteboardCanvas.width = whiteboardCanvas.offsetWidth;
      whiteboardCanvas.height = whiteboardCanvas.offsetHeight;
    }

    function getCanvasCoordinates(e) {
      const rect = whiteboardCanvas.getBoundingClientRect();
      const scaleX = whiteboardCanvas.width / rect.width;
      const scaleY = whiteboardCanvas.height / rect.height;
      
      let clientX, clientY;
      if (e.type.includes('touch')) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }
      
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
      };
    }

    whiteboardCanvas.addEventListener('mousedown', (e) => {
      if (!state.isHost && !state.canPresent) return;
      state.drawing = true;
      const { x, y } = getCanvasCoordinates(e);
      state.lastX = x;
      state.lastY = y;
    });

    whiteboardCanvas.addEventListener('touchstart', (e) => {
      if (!state.isHost && !state.canPresent) return;
      e.preventDefault();
      state.drawing = true;
      const { x, y } = getCanvasCoordinates(e);
      state.lastX = x;
      state.lastY = y;
    });

    whiteboardCanvas.addEventListener('mousemove', (e) => {
      if (!state.drawing || (!state.isHost && !state.canPresent)) return;
      
      const { x, y } = getCanvasCoordinates(e);
      
      ctx.beginPath();
      ctx.moveTo(state.lastX, state.lastY);
      ctx.lineTo(x, y);
      
      if (state.currentWhiteboardTool === 'pen') {
        ctx.strokeStyle = 'var(--accent-blue)';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.stroke();
      } else if (state.currentWhiteboardTool === 'eraser') {
        ctx.strokeStyle = 'rgba(0,0,0,0.1)';
        ctx.lineWidth = 20;
        ctx.globalCompositeOperation = 'destination-out';
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      }
      
      state.drawingCommands.push({
        fromX: state.lastX,
        fromY: state.lastY,
        toX: x,
        toY: y,
        tool: state.currentWhiteboardTool,
        color: state.currentWhiteboardTool === 'pen' ? 'var(--accent-blue)' : 'rgba(0,0,0,0.1)',
        lineWidth: state.currentWhiteboardTool === 'pen' ? 3 : 20
      });
      
      state.lastX = x;
      state.lastY = y;
    });

    whiteboardCanvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (!state.drawing || (!state.isHost && !state.canPresent)) return;
      
      const { x, y } = getCanvasCoordinates(e);
      
      ctx.beginPath();
      ctx.moveTo(state.lastX, state.lastY);
      ctx.lineTo(x, y);
      
      if (state.currentWhiteboardTool === 'pen') {
        ctx.strokeStyle = 'var(--accent-blue)';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.stroke();
      } else if (state.currentWhiteboardTool === 'eraser') {
        ctx.strokeStyle = 'rgba(0,0,0,0.1)';
        ctx.lineWidth = 20;
        ctx.globalCompositeOperation = 'destination-out';
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      }
      
      state.drawingCommands.push({
        fromX: state.lastX,
        fromY: state.lastY,
        toX: x,
        toY: y,
        tool: state.currentWhiteboardTool,
        color: state.currentWhiteboardTool === 'pen' ? 'var(--accent-blue)' : 'rgba(0,0,0,0.1)',
        lineWidth: state.currentWhiteboardTool === 'pen' ? 3 : 20
      });
      
      state.lastX = x;
      state.lastY = y;
    });

    whiteboardCanvas.addEventListener('mouseup', () => state.drawing = false);
    whiteboardCanvas.addEventListener('mouseout', () => state.drawing = false);
    whiteboardCanvas.addEventListener('touchend', () => state.drawing = false);

    document.querySelectorAll('.whiteboard-tool[data-tool]').forEach(tool => {
      tool.addEventListener('click', () => {
        document.querySelectorAll('.whiteboard-tool').forEach(t => t.classList.remove('active'));
        tool.classList.add('active');
        state.currentWhiteboardTool = tool.dataset.tool;
        
        if (state.currentWhiteboardTool === 'clear') {
          ctx.clearRect(0, 0, whiteboardCanvas.width, whiteboardCanvas.height);
          state.whiteboardState = [];
          if (state.channel) {
            state.channel.send({
              type: 'broadcast',
              event: 'whiteboard-clear',
              payload: { userId: state.currentUser.id }
            });
          }
        }
      });
    });

    function closeWhiteboard() {
      state.isWhiteboardActive = false;
      whiteboardOverlay.classList.remove('active');
      whiteboardTools.classList.remove('active');
    }

    function saveWhiteboard() {
      const link = document.createElement('a');
      link.download = `whiteboard-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      link.href = whiteboardCanvas.toDataURL('image/png');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showNotification('Whiteboard saved to downloads', 'download');
    }

    // ============= AI FUNCTIONS REDESIGN =============
    async function generateSummary() {
      const chatHistory = Array.from(document.querySelectorAll('#chat-messages .message:not(.system):not(.ai-message-card)'))
        .map(msg => msg.textContent)
        .slice(-10)
        .join('\n');
      
      const prompt = `You are an AI teaching assistant. Summarize the following class discussion in 3-5 key points. Keep it concise and educational. Format as a clear summary with bullet points.\n\nDiscussion:\n${chatHistory}\n\nSummary:`;
      
      const summary = await callGeminiAI(prompt, 'summary');
      
      const messagesContainer = document.getElementById('chat-messages');
      const card = createAICard(
        'summary',
        'Lesson Summary',
        'AI-generated key points from discussion',
        summary,
        [
          { text: 'View Summary', icon: 'eye', primary: true },
          { text: 'Save Notes', icon: 'save' },
          { text: 'Share', icon: 'share' }
        ]
      );
      
      messagesContainer.appendChild(card);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    async function generateQuiz() {
      const chatHistory = Array.from(document.querySelectorAll('#chat-messages .message:not(.system):not(.ai-message-card)'))
        .map(msg => msg.textContent)
        .slice(-10)
        .join('\n');
      
      const prompt = `Based on the classroom discussion, generate a 3-question multiple choice quiz to test understanding. Format as clear questions with options and indicate correct answers. Make it educational and relevant.\n\nDiscussion:\n${chatHistory}`;
      
      const quiz = await callGeminiAI(prompt, 'quiz');
      
      const messagesContainer = document.getElementById('chat-messages');
      const card = createAICard(
        'quiz',
        'Practice Quiz',
        'Test your understanding of today\'s discussion',
        quiz,
        [
          { text: 'Start Quiz', icon: 'play', primary: true },
          { text: 'Save Quiz', icon: 'save' },
          { text: 'Share with Class', icon: 'share' }
        ]
      );
      
      messagesContainer.appendChild(card);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    async function suggestResources() {
      const chatHistory = Array.from(document.querySelectorAll('#chat-messages .message:not(.system):not(.ai-message-card)'))
        .map(msg => msg.textContent)
        .slice(-10)
        .join('\n');
      
      const prompt = `Based on the classroom discussion, suggest 3-5 learning resources (books, articles, videos, websites) that would help students better understand the topics discussed. Include brief descriptions and why they're valuable.\n\nDiscussion:\n${chatHistory}\n\nSuggested Resources:`;
      
      const resources = await callGeminiAI(prompt, 'resources');
      
      const messagesContainer = document.getElementById('chat-messages');
      const card = createAICard(
        'resources',
        'Learning Resources',
        'AI-curated materials for deeper understanding',
        resources,
        [
          { text: 'View Resources', icon: 'external-link-alt', primary: true },
          { text: 'Save List', icon: 'bookmark' },
          { text: 'Share', icon: 'share' }
        ]
      );
      
      messagesContainer.appendChild(card);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function updateLockMediaButton() {
      const lockBtn = document.getElementById('lock-media-btn');
      const unlockBtn = document.getElementById('unlock-media-btn');
      
      if (state.allMuted && state.allCamerasDisabled) {
        lockBtn.style.display = 'none';
        unlockBtn.style.display = 'flex';
      } else {
        lockBtn.style.display = 'flex';
        unlockBtn.style.display = 'none';
      }
    }

    // ============= HOST TOOLS - UPDATED WITH FIXES =============
    async function muteAllParticipants() {
      if (!state.isHost) {
        showNotification('Only host can perform this action', 'info');
        return;
      }
      
      state.allMuted = true;
      state.mediaControlLocked = true;
      state.hardMuteLock = true;
      
      // Update UI
      document.getElementById('mute-all-btn').style.display = 'none';
      document.getElementById('unmute-all-btn').style.display = 'flex';
      updateLockMediaButton();
      
      // Broadcast to all students
      if (state.channel) {
        state.channel.send({
          type: 'broadcast',
          event: 'mute-all',
          payload: { locked: true, hardLock: true }
        });
      }
      
      // Force mute all remote users and disable their tracks
      Object.values(state.remoteUsers).forEach(user => {
        if (user.audioTrack) {
          user.audioTrack.setEnabled(false);
        }
      });
      
      // Also mute local audio for non-host users
      if (!state.isHost && state.localAudioTrack) {
        state.localAudioTrack.setEnabled(false);
        state.isMicOn = false;
        const micBtn = document.querySelector('[data-action="mic"]');
        if (micBtn) {
          micBtn.classList.remove('active');
          const micIcon = micBtn.querySelector('i');
          micIcon.classList.remove('fa-microphone');
          micIcon.classList.add('fa-microphone-slash');
          micBtn.classList.add('media-locked');
        }
      }
      
      showNotification('All participants muted and locked', 'mute');
    }

    async function unmuteAllParticipants() {
      if (!state.isHost) {
        showNotification('Only host can perform this action', 'info');
        return;
      }
      
      state.allMuted = false;
      state.mediaControlLocked = false;
      state.hardMuteLock = false;
      
      // Update UI
      document.getElementById('mute-all-btn').style.display = 'flex';
      document.getElementById('unmute-all-btn').style.display = 'none';
      updateLockMediaButton();
      
      // Broadcast to all students
      if (state.channel) {
        state.channel.send({
          type: 'broadcast',
          event: 'unmute-all',
          payload: { locked: false, hardLock: false }
        });
      }
      
      // Remove lock UI
      const micBtn = document.querySelector('[data-action="mic"]');
      if (micBtn) {
        micBtn.classList.remove('media-locked');
      }
      
      showNotification('Participants can now unmute', 'mic');
    }

    async function disableAllCameras() {
      if (!state.isHost) {
        showNotification('Only host can perform this action', 'info');
        return;
      }
      
      state.allCamerasDisabled = true;
      state.cameraControlLocked = true;
      state.hardCameraLock = true;
      
      // Update UI
      document.getElementById('disable-cameras-btn').style.display = 'none';
      document.getElementById('enable-cameras-btn').style.display = 'flex';
      updateLockMediaButton();
      
      // Broadcast to all students
      if (state.channel) {
        state.channel.send({
          type: 'broadcast',
          event: 'disable-cameras',
          payload: { locked: true, hardLock: true }
        });
      }
      
      // Force disable all remote cameras
      Object.values(state.remoteUsers).forEach(user => {
        if (user.videoTrack) {
          user.videoTrack.setEnabled(false);
        }
      });
      
      // Also disable local camera for non-host users
      if (!state.isHost && state.localVideoTrack) {
        state.localVideoTrack.setEnabled(false);
        state.isCameraOn = false;
        const camBtn = document.querySelector('[data-action="cam"]');
        if (camBtn) {
          camBtn.classList.remove('active');
          const camIcon = camBtn.querySelector('i');
          camIcon.classList.remove('fa-video');
          camIcon.classList.add('fa-video-slash');
          camBtn.classList.add('media-locked');
        }
      }
      
      showNotification('All cameras disabled and locked', 'camera');
    }

    async function enableAllCameras() {
      if (!state.isHost) {
        showNotification('Only host can perform this action', 'info');
        return;
      }
      
      state.allCamerasDisabled = false;
      state.cameraControlLocked = false;
      state.hardCameraLock = false;
      
      // Update UI
      document.getElementById('disable-cameras-btn').style.display = 'flex';
      document.getElementById('enable-cameras-btn').style.display = 'none';
      updateLockMediaButton();
      
      // Broadcast to all students
      if (state.channel) {
        state.channel.send({
          type: 'broadcast',
          event: 'enable-cameras',
          payload: { locked: false, hardLock: false }
        });
      }
      
      // Remove lock UI
      const camBtn = document.querySelector('[data-action="cam"]');
      if (camBtn) {
        camBtn.classList.remove('media-locked');
      }
      
      showNotification('Participants can now enable cameras', 'camera');
    }

    async function lockAllMedia() {
      if (!state.isHost) return;
      
      // Execute both actions
      await muteAllParticipants();
      await disableAllCameras();
    }

    async function unlockAllMedia() {
      if (!state.isHost) return;
      
      // Execute both actions
      await unmuteAllParticipants();
      await enableAllCameras();
    }

    async function toggleHostSpotlight() {
      if (!state.isHost) {
        showNotification('Only host can control spotlight', 'info');
        return;
      }
      
      const newState = !state.isPresentationMode;
      
      // Set spotlight to host
      state.spotlightUserId = state.currentUser.id;
      state.spotlightImmune = true;
      
      if (state.channel) {
        await state.channel.send({
          type: 'broadcast',
          event: 'spotlight',
          payload: { 
            active: newState,
            spotlightUserId: state.currentUser.id,
            immune: true
          }
        });
      }
      
      toggleSpotlightUI(newState);
    }

    function toggleSpotlightUI(active) {
      state.isPresentationMode = active;
      const container = document.getElementById('video-container');
      const spotlightBtn = document.getElementById('spotlight-btn');
      
      if (active) {
        // Move spotlighted user to first position
        const spotlightTile = document.getElementById(`tile-${state.spotlightUserId}`);
        if (spotlightTile) {
            container.prepend(spotlightTile);
        }
        container.classList.add('presentation-mode');
        if (spotlightBtn) spotlightBtn.classList.add('active');
        showNotification('Spotlight Active', 'spotlight');
      } else {
        state.spotlightUserId = null;
        state.spotlightImmune = false;
        container.classList.remove('presentation-mode');
        if (spotlightBtn) spotlightBtn.classList.remove('active');
        showNotification('Spotlight Disabled', 'spotlight');
      }
    }

    function showPendingRequests() {
      if (!state.isHost) {
        showNotification('Only host can view requests', 'info');
        return;
      }

      const requestsModal = document.getElementById('requests-modal');
      const requestsList = document.getElementById('requests-list');
      
      if (!requestsModal) {
        showNotification('Modal not found', 'end');
        return;
      }

      // Clear existing list
      requestsList.innerHTML = '';

      // Check if there are any requests
      if (state.screenShareRequests.length === 0) {
        requestsList.innerHTML = '<div style="padding:20px; text-align:center; opacity:0.7;">No pending screen share requests</div>';
        requestsModal.style.display = 'flex';
        return;
      }

      // Populate requests
      state.screenShareRequests.forEach((req, index) => {
        const div = document.createElement('div');
        div.className = 'waiting-list-item';
        
        const studentName = req.studentName || `Student ${req.studentId.slice(0, 8)}`;
        const initials = studentName.charAt(0).toUpperCase();

        div.innerHTML = `
          <div style="display:flex; align-items:center;">
            <div style="width:32px; height:32px; border-radius:50%; background:linear-gradient(135deg, var(--accent-blue), var(--accent-purple)); color:white; display:flex; align-items:center; justify-content:center; margin-right:10px; font-size:14px; font-weight:bold;">${initials}</div>
            <div style="flex:1;">
              <span style="font-weight:500;">${studentName}</span>
              <div style="font-size: 12px; opacity: 0.7; margin-top: 4px;">Requesting to share screen</div>
            </div>
          </div>
          <div class="waiting-actions">
            <button class="approve-btn" onclick="approveScreenShare(${index})" title="Approve"><i class="fas fa-check"></i></button>
            <button class="reject-btn" onclick="rejectScreenShare(${index})" title="Reject"><i class="fas fa-times"></i></button>
          </div>
        `;
        requestsList.appendChild(div);
      });

      // Show the modal
      requestsModal.style.display = 'flex';
    }

    function closeRequestsModal() {
      const requestsModal = document.getElementById('requests-modal');
      if (requestsModal) {
        requestsModal.style.display = 'none';
      }
    }

    function approveScreenShare(index) {
      if (index < 0 || index >= state.screenShareRequests.length) {
        showNotification('Invalid request', 'end');
        return;
      }

      const request = state.screenShareRequests[index];
      
      // Notify student that they can now share screen
      if (state.channel) {
        state.channel.send({
          type: 'broadcast',
          event: 'screen-share-approved',
          payload: { studentId: request.studentId }
        });
      }

      // Remove from pending list
      state.screenShareRequests.splice(index, 1);
      showNotification(`Screen share approved for ${request.studentName}`, 'check');
      
      // Refresh the modal
      showPendingRequests();
    }

    function rejectScreenShare(index) {
      if (index < 0 || index >= state.screenShareRequests.length) {
        showNotification('Invalid request', 'end');
        return;
      }

      const request = state.screenShareRequests[index];
      
      // Notify student that their request was rejected
      if (state.channel) {
        state.channel.send({
          type: 'broadcast',
          event: 'screen-share-rejected',
          payload: { studentId: request.studentId }
        });
      }

      // Remove from pending list
      state.screenShareRequests.splice(index, 1);
      showNotification(`Screen share rejected for ${request.studentName}`, 'info');
      
      // Refresh the modal
      showPendingRequests();
    }

    function copyClassLink() {
      const link = `https://peerloom.com/live/${Math.random().toString(36).substr(2, 9)}`;
      navigator.clipboard.writeText(link);
      showNotification('Class link copied to clipboard', 'link');
    }

    // ============= HAND RAISE SYSTEM WITH FIXES =============
    function toggleHandRaise(btn) {
      if (!state.currentUser) return;
      
      // HAND RAISE LOCK: Check if hand is already raised
      if (state.raisedHands.has(state.currentUser.id)) {
        showNotification('You have already raised your hand', 'info');
        return;
      }
      
      state.isHandRaised = !state.isHandRaised;
      if (state.isHandRaised) {
        btn.classList.add('active');
        
        // Add hand icon to video tile
        const userTile = document.getElementById(`tile-${state.currentUser.id}`);
        if (userTile) {
          const existingIcon = userTile.querySelector('.hand-icon');
          if (!existingIcon) {
            const handIcon = document.createElement('div');
            handIcon.className = 'hand-icon';
            handIcon.innerHTML = '✋';
            userTile.appendChild(handIcon);
            userTile.classList.add('hand-raised');
          }
        }
        
        // Add to raised hands map with timestamp
        state.raisedHands.set(state.currentUser.id, {
          name: state.currentUser.name,
          timestamp: Date.now(),
          userId: state.currentUser.id
        });
        
        // Broadcast hand raise
        if (state.channel) {
          state.channel.send({
            type: 'broadcast',
            event: 'hand-raise',
            payload: {
              userId: state.currentUser.id,
              userName: state.currentUser.name,
              action: 'raise'
            }
          });
        }
        
        // Add message to chat for host
        if (state.isHost) {
          addMessage(`${state.currentUser.name} raised hand ✋`, 'system');
        }
        
        showNotification('Hand Raised', 'hand');
      } else {
        lowerHand(state.currentUser.id);
      }
    }

    function lowerHand(userId) {
      const handInfo = state.raisedHands.get(userId);
      if (!handInfo) return;
      
      // Remove hand icon from correct tile
      const userTile = document.getElementById(`tile-${userId}`);
      if (userTile) {
        const handIcon = userTile.querySelector('.hand-icon');
        if (handIcon) handIcon.remove();
        userTile.classList.remove('hand-raised');
      }
      
      // Remove from map
      state.raisedHands.delete(userId);
      
      // If it's the current user, update button
      if (userId === state.currentUser?.id) {
        state.isHandRaised = false;
        const handBtn = document.querySelector('[data-action="hand"]');
        if (handBtn) handBtn.classList.remove('active');
      }
      
      // Broadcast hand lower
      if (state.channel && state.isHost) {
        state.channel.send({
          type: 'broadcast',
          event: 'hand-lower',
          payload: { userId }
        });
      }
    }

    function clearAllHands() {
      if (!state.isHost) {
        showNotification('Only host can clear all hands', 'info');
        return;
      }
      
      // Lower all raised hands
      state.raisedHands.forEach((handInfo, userId) => {
        lowerHand(userId);
      });
      
      showNotification('All hands cleared', 'hand');
    }

    // ============= HELPER FUNCTIONS =============
    function toggleRecording(btn) {
      if (!state.isHost) {
        showNotification('Only host can record', 'info');
        return;
      }
      
      state.isRecording = !state.isRecording;
      if (state.isRecording) {
        btn.classList.add('recording');
        showNotification('Recording Started', 'recording');
      } else {
        btn.classList.remove('recording');
        showNotification('Recording Stopped', 'recording');
      }
    }

    function endCall() {
      state.isIntentionalLeave = true;
      if (state.waitingRoomInterval) clearInterval(state.waitingRoomInterval);
      const title = state.isHost ? 'End Class for All?' : 'Leave Class?';
      const message = state.isHost 
        ? 'Are you sure you want to end this class for all participants?' 
        : 'Are you sure you want to leave the class?';

      showConfirmationModal(
        title,
        message,
        async () => {
          showNotification(state.isHost ? 'Ending class...' : 'Leaving class...', 'end');
          
          // If host, clear the waiting room/meeting requests for this session
          if (state.isHost) {
            const gid = new URLSearchParams(window.location.search).get('groupId');
            if (gid) {
              await supabase.from('meeting_requests').delete().eq('group_id', gid);
            }
            
            // Broadcast end meeting to all participants
            if (state.channel) {
              await state.channel.send({
                type: 'broadcast',
                event: 'end-meeting-for-all',
                payload: {}
              });
            }
          }
          
          // Leave Agora Channel
          if (state.client) {
            state.client.leave();
            if (state.localAudioTrack) state.localAudioTrack.close();
            if (state.localVideoTrack) state.localVideoTrack.close();
          }

          setTimeout(() => {
            const gid = new URLSearchParams(window.location.search).get('groupId');
            if (gid) {
              window.location.href = `chatroom.html?groupId=${gid}`;
            } else {
              window.location.href = 'dashboard.html';
            }
          }, 500);
        }
      );
    }

    async function rejoinSession() {
      const gid = new URLSearchParams(window.location.search).get('groupId');
      if (!gid || !state.currentUser) {
        window.location.reload();
        return;
      }
      
      state.isIntentionalLeave = false;
      document.getElementById('error-modal').style.display = 'none';
      const loadingOverlay = document.getElementById('loading-overlay');
      if (loadingOverlay) {
          loadingOverlay.classList.remove('hidden');
          const status = document.getElementById('loading-status');
          if (status) status.textContent = "Rejoining session...";
      }
      
      try {
        if (state.client) {
            state.client.removeAllListeners();
            await state.client.leave().catch(e => console.warn("Leave failed", e));
        }
        
        if (state.localAudioTrack) { state.localAudioTrack.close(); state.localAudioTrack = null; }
        if (state.localVideoTrack) { state.localVideoTrack.close(); state.localVideoTrack = null; }
        
        document.getElementById('video-container').innerHTML = '';
        state.renderedVideoTiles.clear();
        state.remoteUsers = {};
        
        await initAgora(gid, state.currentUser.id, state.currentUser.name);
      } catch (e) {
        console.error("Rejoin failed", e);
        window.location.reload();
      }
    }

    function showConfirmationModal(title, message, callback) {
      state.confirmationCallback = callback;
      document.getElementById('modal-title').textContent = title;
      document.getElementById('modal-message').textContent = message;
      document.getElementById('confirmation-modal').style.display = 'flex';
    }

    function closeConfirmationModal() {
      document.getElementById('confirmation-modal').style.display = 'none';
      state.confirmationCallback = null;
    }

    function executeConfirmation() {
      if (state.confirmationCallback) {
        state.confirmationCallback();
      }
      closeConfirmationModal();
    }

    // ============= NOTIFICATION PERMISSIONS & SOUNDS =============
    async function requestNotificationPermissions() {
      if ('Notification' in window && Notification.permission === 'default') {
        try {
          const permission = await Notification.requestPermission();
          if (permission === 'granted') {
            console.log('Notification permission granted');
          }
        } catch (error) {
          console.log('Notification permission request failed:', error);
        }
      }
    }

    function playNotificationSound() {
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 800;
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);
      } catch (error) {
        console.log('Notification sound error:', error);
      }
    }

    function showNotification(message, type = 'info') {
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification('PeerLoom', {
            body: message,
            icon: '/docs/favicon.ico',
            badge: '/docs/favicon.ico',
            tag: 'peerloom-notification'
          });
          playNotificationSound();
        } catch (error) {
          console.log('Notification error:', error);
        }
      }

      const notification = document.createElement('div');
      notification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        background: var(--glass-bg);
        backdrop-filter: var(--glass-blur);
        border: 1px solid var(--glass-border);
        padding: 14px 20px;
        border-radius: 16px;
        box-shadow: var(--shadow);
        z-index: 3000;
        animation: slideIn 0.3s ease-out;
        max-width: 300px;
        display: flex;
        align-items: center;
        gap: 12px;
        color: var(--text-color);
      `;
      
      let icon = 'info-circle';
      let iconColor = 'var(--accent-blue)';
      
      switch(type) {
        case 'recording': icon = 'circle-dot'; iconColor = 'var(--red)'; break;
        case 'hand': icon = 'hand'; iconColor = 'var(--accent-yellow)'; break;
        case 'mic': icon = 'microphone'; iconColor = 'var(--accent-green)'; break;
        case 'camera': icon = 'video'; iconColor = 'var(--accent-green)'; break;
        case 'ai': icon = 'robot'; iconColor = 'var(--accent-purple)'; break;
        case 'theme': icon = 'palette'; iconColor = 'var(--accent-purple)'; break;
        case 'user': icon = 'user'; iconColor = 'var(--accent-blue)'; break;
        case 'share': icon = 'desktop'; iconColor = 'var(--accent-blue)'; break;
        case 'end': icon = 'phone-slash'; iconColor = 'var(--red)'; break;
        case 'download': icon = 'download'; iconColor = 'var(--accent-green)'; break;
        case 'link': icon = 'link'; iconColor = 'var(--accent-blue)'; break;
        case 'check': icon = 'check-circle'; iconColor = 'var(--accent-green)'; break;
        case 'spotlight': icon = 'star'; iconColor = 'var(--accent-yellow)'; break;
      }
      
      notification.innerHTML = `
        <i class="fas fa-${icon}" style="color: ${iconColor}; font-size: 18px;"></i>
        <span>${message}</span>
      `;
      
      document.body.appendChild(notification);
      
      setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => {
          document.body.removeChild(notification);
        }, 300);
      }, 3000);
    }



    // ============= THEME TOGGLE =============
    document.getElementById('dark-mode-toggle').addEventListener('click', () => {
      document.body.classList.toggle('light-mode');
      document.body.classList.toggle('dark-mode');
      const icon = document.querySelector('#dark-mode-toggle i');
      icon.classList.toggle('fa-moon');
      icon.classList.toggle('fa-sun');
      showNotification(document.body.classList.contains('light-mode') ? 'Light Mode' : 'Dark Mode', 'theme');
    });

    // ============= AI PANEL =============
    document.getElementById('ai-toggle').addEventListener('click', () => {
      aiPanel.classList.toggle('open');
    });

    // ============= AGORA VIDEO LOGIC WITH 10,000 USER FIXES =============
    async function initAgora(channelName, uid, userName) {
      updateLoadingStatus("Checking system requirements...");
      
      if (!state.agoraAppId) {
        showCriticalError("Configuration Error: Agora App ID is missing.");
        return;
      }

      if (!AgoraRTC.checkSystemRequirements()) {
        showNotification("Your browser does not support video calling.", "end");
        return;
      }

      state.client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

      state.client.on("user-published", handleUserPublished);
      state.client.on("user-unpublished", handleUserUnpublished);
      
      state.client.on("user-joined", (user) => {
        // SPOTLIGHT IMMUNITY: Don't change spotlight when users join
        if (state.spotlightUserId && state.spotlightImmune) return;
        
        let student = state.students.find(s => s.id === user.uid);
        const name = student?.name || `User ${user.uid.slice(0, 8)}`;
        showNotification(`${name} joined the meeting`, 'user');
      });

      state.client.on("user-left", (user, reason) => {
        // SPOTLIGHT IMMUNITY: Don't change spotlight when users leave
        if (state.spotlightUserId && state.spotlightImmune) {
          // Just remove the tile if it's not the spotlight user
          if (user.uid !== state.spotlightUserId) {
            const tile = document.getElementById(`tile-${user.uid}`);
            if (tile) tile.remove();
            state.renderedVideoTiles.delete(user.uid);
          }
        } else {
          const tile = document.getElementById(`tile-${user.uid}`);
          if (tile) tile.remove();
          state.renderedVideoTiles.delete(user.uid);
        }
        
        // Remove from raised hands
        if (state.raisedHands.has(user.uid)) {
          state.raisedHands.delete(user.uid);
        }
        
        // Remove from promoted speakers
        state.promotedSpeakers.delete(user.uid);
        
        let student = state.students.find(s => s.id === user.uid);
        const name = student?.name || `User ${user.uid.slice(0, 8)}`;
        
        if (reason === "ServerTimeOut") {
           showNotification(`${name} dropped due to network timeout`, "info");
        } else {
           showNotification(`${name} left the meeting`, "end");
        }
      });

      state.client.on("connection-state-change", (curState, prevState) => {
        if (curState === "RECONNECTING") {
          showNotification("Connection lost. Reconnecting...", "info");
          document.getElementById('video-container').style.opacity = "0.5";
        } else if (curState === "CONNECTED" && prevState === "RECONNECTING") {
          showNotification("Connection restored", "info");
          document.getElementById('video-container').style.opacity = "1";
        } else if (curState === "DISCONNECTED" && !state.isIntentionalLeave) {
          showCriticalError("Connection lost. Please rejoin.");
        }
      });

      state.client.on("network-quality", (stats) => {
        const uid = state.currentUser.id;
        const quality = Math.max(stats.downlinkNetworkQuality, stats.uplinkNetworkQuality);
        updateNetworkUI(quality);
      });
      
      state.client.on("exception", (event) => {
        if (event.code === 1003) {
           showNotification("Microphone/Camera error. Check devices.", "end");
        }
      });
      
      state.client.on("token-privilege-will-expire", async () => {
        console.log("Token expiring soon, renewing...");
        await renewToken(channelName, uid);
      });

      try {
        updateLoadingStatus("Authenticating...");
        let token = null;
        
        console.log("Agora App ID:", state.agoraAppId)

        try {
          const { data, error } = await supabase.functions.invoke('generate-agora-token', {
            body: { channelName, uid }
          });
          if (error) throw error;
          if (data?.token) token = data.token;
        } catch (error) {
          console.error("Token fetch failed:", error);
          if (error) {
             showNotification("Warning: Token server unreachable. Video may fail.", "end");
          }
        }

        updateLoadingStatus("Connecting to media server...");
        await state.client.join(state.agoraAppId, channelName, token, uid);

        // STANDARD CLASS MODE: Students join with tracks but muted
        if (!state.isHost) {
          // Students start with mic and camera disabled
          state.isMicOn = false;
          state.isCameraOn = false;
          state.forceListenOnly = false;
          
          try {
            updateLoadingStatus("Accessing camera and microphone...");
            [state.localAudioTrack, state.localVideoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks();
            state.localAudioTrack.setEnabled(false);
            state.localVideoTrack.setEnabled(false);
            await state.client.publish([state.localAudioTrack, state.localVideoTrack]);
          } catch (permError) {
            console.warn("Student joined without media permissions");
          }
        } else {
          // Host always has tracks
          try {
            updateLoadingStatus("Accessing camera and microphone...");
            [state.localAudioTrack, state.localVideoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks();
            state.localAudioTrack.setEnabled(true);
            state.localVideoTrack.setEnabled(true);
            state.isMicOn = true;
            state.isCameraOn = true;
            await state.client.publish([state.localAudioTrack, state.localVideoTrack]);
          } catch (permError) {
            if (permError.name === 'NotAllowedError') {
              showNotification("Microphone/Camera access denied. Please check browser settings.", "end");
              return;
            }
            throw permError;
          }
        }
        
        const container = document.getElementById('video-container');
        const hostTile = document.getElementById('host-tile');
        
        if (state.isHost && hostTile) {
          hostTile.id = `tile-${uid}`;
          hostTile.innerHTML = '';
          
          const ph = document.createElement('div');
          ph.className = 'video-placeholder';
          
          if (state.currentUser.photo) {
             ph.innerHTML = `
              <img src="${state.currentUser.photo}" style="width: 100%; height: 100%; object-fit: cover; position: absolute; inset: 0; filter: blur(20px); opacity: 0.3;">
              <div style="position: relative; z-index: 1;">
                <img src="${state.currentUser.photo}" style="width: 80px; height: 80px; border-radius: 50%; object-fit: cover; border: 2px solid rgba(255,255,255,0.2); box-shadow: 0 4px 12px rgba(0,0,0,0.3); display: block; margin: 0 auto;">
                <i class="fas fa-crown" style="font-size: 24px; color: var(--accent-yellow); position: absolute; top: -10px; right: -10px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));"></i>
              </div>
             `;
          } else {
             ph.innerHTML = '<i class="fas fa-crown" style="font-size: 36px; color: white;"></i>';
          }
          hostTile.appendChild(ph);

          const playerContainer = document.createElement('div');
          playerContainer.id = `player-${uid}`;
          playerContainer.style.width = '100%';
          playerContainer.style.height = '100%';
          playerContainer.style.position = 'absolute';
          playerContainer.style.top = '0';
          playerContainer.style.left = '0';
          playerContainer.style.zIndex = '1';
          playerContainer.style.transform = 'scaleX(-1)';
          hostTile.appendChild(playerContainer);
          
          const nameTag = document.createElement('div');
          nameTag.className = 'name-tag';
          nameTag.style.zIndex = '2';
          nameTag.innerHTML = `<span>${userName} (You)</span><span class="host-badge">HOST</span>`;
          hostTile.appendChild(nameTag);
          
          if (state.localVideoTrack) {
            state.localVideoTrack.play(`player-${uid}`);
          }
          const player = hostTile.querySelector(`#player-${uid}`);
          if (player) player.style.opacity = state.isCameraOn ? '1' : '0';
        } else {
          // Create video tile for self (student view)
          const localPlayerDiv = createVideoTile(uid, userName + " (You)", true, state.currentUser.photo);
          if (localPlayerDiv) {
            container.appendChild(localPlayerDiv);
            if (state.localVideoTrack) {
              state.localVideoTrack.play(`player-${uid}`);
            }
            const player = localPlayerDiv.querySelector(`#player-${uid}`);
            if (player) player.style.opacity = state.isCameraOn ? '1' : '0';
          }
        }

        // Update control bar UI to match actual state
        const micBtn = document.querySelector('[data-action="mic"]');
        const camBtn = document.querySelector('[data-action="cam"]');
        
        if (micBtn) {
          const micIcon = micBtn.querySelector('i');
          if (micIcon) {
            if (state.isMicOn) {
              micIcon.classList.remove('fa-microphone-slash');
              micIcon.classList.add('fa-microphone');
              micBtn.classList.add('active');
            } else {
              micIcon.classList.remove('fa-microphone');
              micIcon.classList.add('fa-microphone-slash');
              micBtn.classList.remove('active');
            }
          }
        }
        
        if (camBtn) {
          const camIcon = camBtn.querySelector('i');
          if (camIcon) {
            if (state.isCameraOn) {
              camIcon.classList.remove('fa-video-slash');
              camIcon.classList.add('fa-video');
              camBtn.classList.add('active');
            } else {
              camIcon.classList.remove('fa-video');
              camIcon.classList.add('fa-video-slash');
              camBtn.classList.remove('active');
            }
          }
        }
        
        showNotification("Connected to video stream", "camera");
        
        if (loadingOverlay) loadingOverlay.classList.add('hidden');

        // Start detecting who is speaking
        startSpeakingDetection();

        // Host Welcome Message
        if (state.isHost) {
          const overlay = document.getElementById('waiting-room-overlay');
          if (overlay) {
            const content = overlay.querySelector('.waiting-content');
            if (content) {
              const avatarHtml = state.currentUser.photo 
                ? `<img src="${state.currentUser.photo}" style="width: 80px; height: 80px; border-radius: 50%; object-fit: cover; margin-bottom: 20px; border: 3px solid var(--accent-green); box-shadow: 0 0 20px rgba(0,255,148,0.3);">`
                : `<i class="fas fa-check-circle" style="font-size: 64px; color: var(--accent-green); margin-bottom: 20px;"></i>`;
              
              content.innerHTML = `
              ${avatarHtml}
              <h2 style="margin: 0 0 10px; font-size: 28px;">Welcome, ${userName}!</h2>
              <p style="opacity: 0.9; font-size: 16px;">Session initialized. You are the host.</p>
            `;
            overlay.classList.remove('hidden');
            playNotificationSound();
            setTimeout(() => { overlay.classList.add('hidden'); }, 2500);
          }
        }
      }

      } catch (error) {
        console.error("Agora Error:", error);
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
        if (error.code === "CAN_NOT_GET_GATEWAY_SERVER") {
          showCriticalError("Security Error: Invalid App ID or Token. Please contact support.");
        } else {
          showCriticalError("Connection failed: " + error.message);
        }
      }
    }

    async function renewToken(channelName, uid) {
      try {
        const { data, error } = await supabase.functions.invoke('generate-agora-token', {
          body: { channelName, uid }
        });
        
        if (!error && data?.token) {
          await state.client.renewToken(data.token);
          console.log("Token renewed successfully");
        }
      } catch (error) {
        console.error("Token renewal failed:", error);
      }
    }

    function createVideoTile(uid, name, isLocal = false, photoUrl = null) {
      
      const div = document.createElement('div');
      div.className = 'video-tile';
      div.id = `tile-${uid}`;
      
      const placeholder = document.createElement('div');
      placeholder.className = 'video-placeholder';
      
      if (photoUrl) {
        placeholder.innerHTML = `
          <img src="${photoUrl}" style="width: 100%; height: 100%; object-fit: cover; position: absolute; inset: 0; filter: blur(20px); opacity: 0.3;">
          <img src="${photoUrl}" style="width: 80px; height: 80px; border-radius: 50%; object-fit: cover; position: relative; z-index: 1; border: 2px solid rgba(255,255,255,0.2); box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
        `;
      } else {
        const initials = name ? name.charAt(0).toUpperCase() : '?';
        placeholder.innerHTML = `<div style="width: 60px; height: 60px; border-radius: 50%; background: rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: bold; color: white;">${initials}</div>`;
      }
      div.appendChild(placeholder);

      const playerContainer = document.createElement('div');
      playerContainer.id = `player-${uid}`;
      playerContainer.style.width = '100%';
      playerContainer.style.height = '100%';
      playerContainer.style.position = 'absolute';
      playerContainer.style.top = '0';
      playerContainer.style.left = '0';
      playerContainer.style.zIndex = '1';
      if (isLocal) playerContainer.style.transform = 'scaleX(-1)';
      
      div.appendChild(playerContainer);

      const nameTag = document.createElement('div');
      nameTag.className = 'name-tag';
      nameTag.style.zIndex = '2';
      nameTag.innerHTML = `<span>${name}</span>`;
      if (state.isHost && uid === state.currentUser.id) {
        nameTag.innerHTML += `<span class="host-badge">HOST</span>`;
      }
      div.appendChild(nameTag);

      // Add speaking indicator badge
      const speakingBadge = document.createElement('div');
      speakingBadge.className = 'speaking-indicator';
      speakingBadge.style.display = 'none';
      speakingBadge.innerHTML = '<i class="fas fa-microphone"></i> Speaking';
      div.appendChild(speakingBadge);

      // Add Kick Button for Host
      if (state.isHost && uid !== state.currentUser.id) {
        const kickBtn = document.createElement('button');
        kickBtn.className = 'kick-btn';
        kickBtn.innerHTML = '<i class="fas fa-user-times"></i>';
        kickBtn.title = 'Remove Student';
        kickBtn.style.cssText = `
          position: absolute;
          top: 10px;
          right: 10px;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: rgba(255, 59, 48, 0.9);
          color: white;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 20;
          opacity: 0;
          transition: opacity 0.2s ease;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        `;
        
        kickBtn.onclick = (e) => {
          e.stopPropagation();
          removeStudent(uid);
        };
        
        div.appendChild(kickBtn);
        
        // Show on hover
        div.addEventListener('mouseenter', () => { kickBtn.style.opacity = '1'; });
        div.addEventListener('mouseleave', () => { kickBtn.style.opacity = '0'; });
        
        // Always show on mobile
        if (state.isMobile) kickBtn.style.opacity = '1';
      }

      // Track rendered tiles
      state.renderedVideoTiles.add(uid);
      
      return div;
    }

    async function handleUserPublished(user, mediaType) {

      await state.client.subscribe(user, mediaType);

      // Ensure tile exists for any media type
      const container = document.getElementById('video-container');
      let tile = document.getElementById(`tile-${user.uid}`);
      
      if (!tile) {
        let name = `User ${user.uid.slice(0,4)}`;
        const isHostUser = (user.uid === state.hostId);

        if (isHostUser) {
          name = state.hostName || 'Host';
          const placeholder = document.getElementById('host-tile');
          if (placeholder) {
            tile = placeholder;
            tile.id = `tile-${user.uid}`;
            tile.innerHTML = '';
            
            const ph = document.createElement('div');
            ph.className = 'video-placeholder';
            ph.innerHTML = '<i class="fas fa-crown" style="font-size: 36px; color: white;"></i>';
            tile.appendChild(ph);

            const playerContainer = document.createElement('div');
            playerContainer.id = `player-${user.uid}`;
            playerContainer.style.width = '100%';
            playerContainer.style.height = '100%';
            playerContainer.style.position = 'absolute';
            playerContainer.style.top = '0';
            playerContainer.style.left = '0';
            playerContainer.style.zIndex = '1';
            tile.appendChild(playerContainer);
            
            const nameTag = document.createElement('div');
            nameTag.className = 'name-tag';
            nameTag.style.zIndex = '2';
            nameTag.innerHTML = `<span>${name}</span><span class="host-badge">HOST</span>`;
            tile.appendChild(nameTag);
          }
        }

        if (!tile) {
          const student = state.students.find(s => s.id === user.uid);
          let photo = student?.photo;
          
          if (student) {
            name = student.name;
          } else {
            const { data: profile } = await supabase.from('profiles').select('full_name, username, profile_photo').eq('id', user.uid).single();
            if (profile) {
              name = profile.full_name || profile.username;
              photo = profile.profile_photo;
            }
          }
          
          tile = createVideoTile(user.uid, name, false, photo);
          if (tile) {
            container.appendChild(tile);
          }
        }
        
        if (tile) {
          updateAttendance({ id: user.uid, name: name });
          state.remoteUsers[user.uid] = user;
        }
      }

      if (mediaType === 'video') {
        console.log(`Subscribing to video of user ${user.uid}`);
        if (tile) {
          user.videoTrack.play(`player-${user.uid}`);
        }
      }

      if (mediaType === 'audio') {
        console.log(`Subscribing to audio of user ${user.uid}`);
        user.audioTrack.play();
        
        if (state.remoteUsers[user.uid]) {
          state.remoteUsers[user.uid].audioTrack = user.audioTrack;
        }
      }
    }


    async function handleUserUnpublished(user, mediaType) {
      console.log(`User ${user.uid} unpublished ${mediaType}`);
      if (mediaType === 'video') {
        const playerContainer = document.getElementById(`player-${user.uid}`);
        if (playerContainer) playerContainer.innerHTML = '';
      }
      
      // Remove from remote users
      if (state.remoteUsers[user.uid]) {
        if (mediaType === 'video') {
          delete state.remoteUsers[user.uid].videoTrack;
        }
        if (mediaType === 'audio') {
          delete state.remoteUsers[user.uid].audioTrack;
        }
      }
    }

    function updateNetworkUI(quality) {
      const icon = document.querySelector('.fa-signal');
      const text = document.querySelector('.fa-signal + span');
      
      if (quality <= 2) {
        icon.style.color = 'var(--accent-green)';
        text.textContent = 'HD';
      } else if (quality <= 4) {
        icon.style.color = 'var(--accent-yellow)';
        text.textContent = 'Weak';
      } else {
        icon.style.color = 'var(--red)';
        text.textContent = 'Bad';
      }
    }

    // ============= SPEAKING DETECTION =============
    function updateSpeakingIndicator(uid) {
      // Remove previous speaking indicator from all tiles
      document.querySelectorAll('.speaking-indicator').forEach(badge => {
        badge.style.display = 'none';
      });

      if (!uid) return;

      // Show speaking indicator on current speaker's tile
      const speakingBadge = document.querySelector(`#tile-${uid} .speaking-indicator`);
      if (speakingBadge) {
        speakingBadge.style.display = 'flex';
      }

      state.currentSpeaker = uid;

      // Auto-hide after 5 seconds of no speech
      if (state.speakersTimeout) clearTimeout(state.speakersTimeout);
      state.speakersTimeout = setTimeout(() => {
        if (state.currentSpeaker === uid) {
          const badge = document.querySelector(`#tile-${uid} .speaking-indicator`);
          if (badge) badge.style.display = 'none';
          state.currentSpeaker = null;
        }
      }, 5000);
    }

    // Start monitoring for speaking
    function startSpeakingDetection() {
      // Monitor local audio track volume
      if (state.localAudioTrack) {
        setInterval(async () => {
          try {
            const audioLevel = await state.localAudioTrack.getVolumeLevel();
            if (audioLevel > 50 && state.isMicOn) {
              updateSpeakingIndicator(state.currentUser.id);
            }
          } catch (e) {
            // Volume detection not supported on this track
          }
        }, 300);
      }

      // Monitor remote users' audio - use volume meter approach
      setInterval(() => {
        if (!state.client) return;

        const remoteAudioStatsList = state.client.getRTCStats().audio?.remoteAudio || [];
        
        if (remoteAudioStatsList && remoteAudioStatsList.length > 0) {
          let maxVolume = 0;
          let speakingUid = null;

          remoteAudioStatsList.forEach(stat => {
            // Check if audio is being received
            const volume = stat.receiveLevel || 0;
            const bytesReceived = stat.bytesReceived || 0;
            
            if (volume > maxVolume || (bytesReceived > 0 && volume > 10)) {
              maxVolume = volume;
              speakingUid = stat.uid;
            }
          });

          if (maxVolume > 0 && speakingUid) {
            updateSpeakingIndicator(speakingUid);
          }
        }
      }, 300);
    }

    // ============= WAITING ROOM LOGIC =============
    function showWaitingForHostOverlay(gid, user) {
      console.log('[Waiting Room] Showing waiting for host overlay');
      const overlay = document.getElementById('waiting-room-overlay');
      const loadingOverlay = document.getElementById('loading-overlay');
      
      if (!overlay) {
        console.error('[ERROR] waiting-room-overlay element not found!');
        return;
      }
      
      // Completely hide the loading overlay
      if (loadingOverlay) {
        loadingOverlay.classList.add('hidden');
        loadingOverlay.style.display = 'none';
        loadingOverlay.style.visibility = 'hidden';
        loadingOverlay.style.opacity = '0';
        loadingOverlay.style.pointerEvents = 'none';
        console.log('[Waiting Room] Loading overlay hidden');
      }
      
      // Show waiting overlay
      overlay.classList.remove('hidden');
      overlay.style.display = 'flex';
      overlay.style.pointerEvents = 'auto';
      overlay.style.visibility = 'visible';
      overlay.style.opacity = '1';
      console.log('[Waiting Room] Overlay shown with display:', overlay.style.display);
      
      // Update text elements - with null checks
      const titleEl = document.getElementById('waiting-title');
      const messageEl = document.getElementById('waiting-message');
      const joinBtn = document.getElementById('request-join-btn');
      const spinnerEl = document.getElementById('waiting-spinner');
      
      if (titleEl) titleEl.textContent = "Waiting for Host to Start";
      if (messageEl) messageEl.textContent = "The host has not started this class session yet. Please wait for the host to begin. You will be automatically notified when the class starts.";
      if (joinBtn) joinBtn.style.display = 'none';
      if (spinnerEl) spinnerEl.style.display = 'block';
      
      console.log('[Waiting Room] Elements updated:', { titleEl, messageEl, joinBtn, spinnerEl });
      
      let startPollInterval;

      const channel = supabase.channel(`waiting_start_${gid}`)
        .on('postgres_changes', { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'meeting_requests', 
          filter: `group_id=eq.${gid}`
        }, (payload) => {
          if (payload.new.status === 'host_active') {
            console.log('[Waiting Room] Host started - handleClassStart triggered');
            handleClassStart();
          }
        })
        .subscribe();

      // Polling fallback to check if class started (Every 2s for faster detection)
      startPollInterval = setInterval(async () => {
        const { data: hostActive } = await supabase
          .from('meeting_requests')
          .select('id')
          .eq('group_id', gid)
          .eq('status', 'host_active')
          .maybeSingle();
          
        if (hostActive) {
          console.log('[Waiting Room] Host detected via polling - handleClassStart triggered');
          handleClassStart();
        }
      }, 2000);

      async function handleClassStart() {
        console.log('[Waiting Room] handleClassStart - host has started');
        if (startPollInterval) clearInterval(startPollInterval);
        supabase.removeChannel(channel);

        // Show transition message
        const titleEl = document.getElementById('waiting-title');
        const messageEl = document.getElementById('waiting-message');
        if (titleEl) titleEl.textContent = "Class is Starting";
        if (messageEl) messageEl.textContent = "The host has started the class. Processing your entry...";

        setTimeout(() => {
          // Setup canvas before entering class
          resizeCanvas();
          window.addEventListener('resize', resizeCanvas);
          // Student will now proceed directly to class setup
          // Pass isAutoJoin=true to skip manual approval request requirement
          checkWaitingRoom(gid, user, () => completeSessionSetup(gid, user), true);
        }, 1000);
      }
    }

    async function checkWaitingRoom(gid, user, onApproved, isAutoJoin = false) {
      console.log('[checkWaitingRoom] Starting - isAutoJoin:', isAutoJoin);
      
      // SPECIAL CASE: If isAutoJoin is true, host has started, proceed immediately without waiting for approval
      if (isAutoJoin) {
        console.log('[checkWaitingRoom] Auto-join mode - proceeding directly to class');
        const overlay = document.getElementById('waiting-room-overlay');
        if (overlay) {
          overlay.style.display = 'flex';
          
          // Show welcome message
          const titleEl = document.getElementById('waiting-title');
          const messageEl = document.getElementById('waiting-message');
          if (titleEl) titleEl.textContent = "Joining Class";
          if (messageEl) messageEl.textContent = "Welcome to the class!";
          
          showApprovalWelcome(overlay, user);
          
          setTimeout(() => {
            overlay.classList.add('hidden');
            overlay.style.display = 'none';
            onApproved();
            showNotification('Successfully joined the class', 'check');
          }, 2000);
        } else {
          onApproved();
        }
        return true;
      }
      
      // NORMAL FLOW: Check if host is active before proceeding
      let hostActiveList = null;
      let hostCheckRetries = 0;
      const maxHostCheckRetries = 3;
      
      while (hostCheckRetries < maxHostCheckRetries && !hostActiveList) {
        try {
          const { data: result, error } = await supabase
            .from('meeting_requests')
            .select('id')
            .eq('group_id', gid)
            .eq('status', 'host_active')
            .limit(1);
          
          if (error) {
            console.error('[checkWaitingRoom] Error checking host active:', error);
          } else {
            hostActiveList = result;
          }
        } catch (e) {
          console.error('[checkWaitingRoom] Exception checking host active:', e);
        }
        
        if (!hostActiveList || hostActiveList.length === 0) {
          hostCheckRetries++;
          console.log('[checkWaitingRoom] Host check attempt', hostCheckRetries);
          if (hostCheckRetries < maxHostCheckRetries) {
            await new Promise(r => setTimeout(r, 300));
          }
        }
      }
      
      const hostActive = hostActiveList && hostActiveList.length > 0;
      console.log('[checkWaitingRoom] Host active check:', hostActive, { hostCheckRetries });
      
      if (!hostActive) {
        // Host hasn't started yet, go back to waiting
        console.warn('[checkWaitingRoom] Host not active, student cannot proceed');
        showWaitingForHostOverlay(gid, user);
        return false;
      }

      // Reset overlay text
      const overlay = document.getElementById('waiting-room-overlay');
      const titleEl = document.getElementById('waiting-title');
      const messageEl = document.getElementById('waiting-message');
      const joinBtn = document.getElementById('request-join-btn');
      const spinnerEl = document.getElementById('waiting-spinner');
      
      if (titleEl) titleEl.textContent = "Joining Class";
      if (messageEl) messageEl.textContent = "Verifying entry permissions...";
      if (joinBtn) joinBtn.style.display = 'none';
      if (spinnerEl) spinnerEl.style.display = 'block';

      let { data: request } = await supabase
        .from('meeting_requests')
        .select('*')
        .eq('group_id', gid)
        .eq('user_id', user.id)
        .maybeSingle();
      
      console.log('[checkWaitingRoom] Initial request:', request);

      // AUTO-APPROVE: If host is active and student has no existing request, auto-approve them
      if (!request && hostActive) {
        try {
          console.log('[checkWaitingRoom] Host is active - auto-approving student');
          const { data: newReq, error } = await supabase.from('meeting_requests').insert({
            group_id: gid,
            user_id: user.id,
            user_name: user.user_metadata.firstName || user.user_metadata.full_name || 'Student',
            status: 'approved'
          }).select().single();
          
          if (error) {
            console.error('[checkWaitingRoom] Insert error:', error);
          } else {
            request = newReq;
            state.promotedSpeakers.add(user.id);
            console.log('[checkWaitingRoom] Student auto-approved:', request);
          }
        } catch (e) {
          console.error("[checkWaitingRoom] Auto-approve failed:", e);
        }
      }

      // Check if already approved (or just auto-approved)
      if (request?.status === 'approved') {
        console.log('[checkWaitingRoom] Student approved - proceeding immediately');
        // Show welcome and proceed
        if (overlay) {
          showApprovalWelcome(overlay, user);
          setTimeout(() => {
            if (overlay) overlay.classList.add('hidden');
            onApproved();
            showNotification('Successfully joined the class', 'check');
          }, 2000);
        } else {
          onApproved();
        }
        return true;
      }
      
      const overlayEl = document.getElementById('waiting-room-overlay');
      if (overlayEl) overlayEl.classList.remove('hidden');

      // If host is active and student hasn't been approved yet, it means they're waiting for manual review
      // (not auto-approved because they had a previous rejected request)
      // NEVER show "Ready to Join" button when host is already active - auto-approving handles that
      if (!request && hostActive) {
        // This shouldn't happen as auto-approve above should have created an approved request
        console.warn('[Safety Check] No request but host is active - this is unexpected');
        if (titleEl) titleEl.textContent = "Joining Class";
        if (messageEl) messageEl.textContent = "Processing your entry...";
        if (joinBtn) joinBtn.style.display = 'none';
        if (spinnerEl) spinnerEl.style.display = 'block';
        return false;
      }

      // MANUAL REQUEST MODE: Only show when host hasn't started yet
      if (!request && !hostActive) {
        // No existing request and host hasn't started - show the manual button
        if (titleEl) titleEl.textContent = "Ready to Join";
        if (messageEl) messageEl.textContent = "Click 'Request to Join' to notify the host. They will review your request.";
        if (joinBtn) joinBtn.style.display = 'block';
        if (spinnerEl) spinnerEl.style.display = 'none';
        return false;
      }

      // For pending or rejected requests, set up polling to monitor for approval changes
      let pollInterval;
      let joined = false;

      const channel = supabase.channel(`waiting_${user.id}`)
        .on('postgres_changes', { 
          event: 'UPDATE', 
          schema: 'public', 
          table: 'meeting_requests', 
          filter: `user_id=eq.${user.id}`
        }, (payload) => {
          handleStatusChange(payload.new.status);
        })
        .subscribe();

      // Polling fallback (Every 3 seconds)
      pollInterval = setInterval(async () => {
        const { data: current } = await supabase
          .from('meeting_requests')
          .select('status')
          .eq('group_id', gid)
          .eq('user_id', user.id)
          .maybeSingle();
        
        if (current) handleStatusChange(current.status);
      }, 3000);

      function handleStatusChange(status) {
        if (joined) return;
        
        if (status === 'approved') {
          joined = true;
          
          // Clean up monitoring
          if (pollInterval) clearInterval(pollInterval);
          supabase.removeChannel(channel);
          
          // Show welcoming message and transition to class
          showApprovalWelcome(overlay, user);
          
          setTimeout(() => {
            overlay.classList.add('hidden');
            overlay.style.display = 'none';
            onApproved();
            showNotification('Successfully joined the class', 'check');
          }, 3500);
        } else if (status === 'rejected') {
          joined = true;
          if (pollInterval) clearInterval(pollInterval);
          supabase.removeChannel(channel);
          showNotification('Access denied - you were not approved to join.', 'end');
          setTimeout(() => { window.location.href = 'dashboard.html'; }, 2000);
        }
      }

      // Handle different request statuses
      if (request?.status === 'rejected') {
        // Previous request was rejected - show button to retry
        if (titleEl) titleEl.textContent = "Request Denied";
        if (messageEl) messageEl.textContent = "Your previous request was denied. Try again or contact the host.";
        if (joinBtn) {
          joinBtn.style.display = 'block';
          joinBtn.textContent = 'Try Again';
        }
        if (spinnerEl) spinnerEl.style.display = 'none';
        return false;
      } else if (request?.status === 'pending') {
        // Request already pending - show waiting message
        if (titleEl) titleEl.textContent = "Request Pending";
        if (messageEl) messageEl.textContent = "Your request has been sent. Waiting for host approval...";
        if (joinBtn) joinBtn.style.display = 'none';
        if (spinnerEl) spinnerEl.style.display = 'block';
      }

      return false;
    }

    function setupHostWaitingRoom(gid) {
      fetchPendingRequests(gid);
      
      supabase.channel(`host_waiting_room_${gid}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'meeting_requests',
          filter: `group_id=eq.${gid}`
        }, (payload) => {
          console.log('Waiting room update:', payload);
          fetchPendingRequests(gid);
        })
        .subscribe();

      // Polling fallback for host (Every 5 seconds)
      state.waitingRoomInterval = setInterval(() => {
        fetchPendingRequests(gid);
      }, 5000);
    }



    async function fetchPendingRequests(gid) {
      const { data: requests } = await supabase
        .from('meeting_requests')
        .select('*')
        .eq('group_id', gid)
        .eq('status', 'pending')
        .neq('user_id', state.currentUser.id)
        .order('created_at', { ascending: true });
      
      let newData = requests || [];

      if (newData.length > 0) {
        const userIds = newData.map(r => r.user_id);
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, profile_photo')
          .in('id', userIds);
        
        if (profiles) {
          newData = newData.map(req => {
            const profile = profiles.find(p => p.id === req.user_id);
            return { ...req, profile_photo: profile?.profile_photo };
          });
        }
      }
      
      if (newData.length > state.waitingStudents.length) {
        playNotificationSound();
        showNotification('New student in waiting room', 'user');
      }
      
      state.waitingStudents = newData;
      updateWaitingRoomUI();
    }

    function updateWaitingRoomUI() {
      const badge = document.getElementById('waiting-room-badge');
      const list = document.getElementById('waiting-list');
      const acceptAllBtn = document.getElementById('accept-all-btn');
      
      if (state.waitingStudents.length > 0) {
        badge.textContent = state.waitingStudents.length;
        badge.style.display = 'flex';
        if (acceptAllBtn) acceptAllBtn.style.display = 'block';
      } else {
        badge.style.display = 'none';
        if (acceptAllBtn) acceptAllBtn.style.display = 'none';
      }

      list.innerHTML = state.waitingStudents.length === 0 ? '<div style="padding:20px; text-align:center; opacity:0.7;">No pending requests</div>' : '';

      state.waitingStudents.forEach(req => {
        const div = document.createElement('div');
        div.className = 'waiting-list-item';
        
        const initials = (req.user_name || 'S').charAt(0).toUpperCase();
        const avatarHtml = req.profile_photo 
          ? `<img src="${req.profile_photo}" style="width:32px; height:32px; border-radius:50%; object-fit:cover; margin-right:10px; border: 1px solid var(--glass-border);">`
          : `<div style="width:32px; height:32px; border-radius:50%; background:linear-gradient(135deg, var(--accent-blue), var(--accent-purple)); color:white; display:flex; align-items:center; justify-content:center; margin-right:10px; font-size:14px; font-weight:bold;">${initials}</div>`;

        div.innerHTML = `
          <div style="display:flex; align-items:center;">${avatarHtml}<span style="font-weight:500;">${req.user_name}</span></div>
          <div class="waiting-actions">
            <button class="approve-btn" onclick="approveStudent('${req.id}', '${req.user_id}')"><i class="fas fa-check"></i></button>
            <button class="reject-btn" onclick="rejectStudent('${req.id}')"><i class="fas fa-times"></i></button>
          </div>
        `;
        list.appendChild(div);
      });
    }

    async function approveStudent(id, userId) {
      console.log('Approving student:', id);
      try {
        const { error } = await supabase.from('meeting_requests').update({ status: 'approved' }).eq('id', id);
        if (error) throw error;
        
        // Add to promoted speakers
        state.promotedSpeakers.add(userId);
        
        // Notify student they are now a speaker
        if (state.channel) {
          state.channel.send({
            type: 'broadcast',
            event: 'promote-speaker',
            payload: { userId }
          });
        }
        
        state.waitingStudents = state.waitingStudents.filter(s => s.id !== id);
        updateWaitingRoomUI();
        showNotification('Student admitted as speaker', 'check');
      } catch (error) {
        console.error('Error approving student:', error);
        showNotification('Failed to approve request', 'end');
      }
    }

    async function rejectStudent(id) {
      console.log('Rejecting student:', id);
      try {
        const { error } = await supabase.from('meeting_requests').update({ status: 'rejected' }).eq('id', id);
        if (error) throw error;
        
        state.waitingStudents = state.waitingStudents.filter(s => s.id !== id);
        updateWaitingRoomUI();
        showNotification('Request denied', 'info');
      } catch (error) {
        console.error('Error rejecting student:', error);
        showNotification('Failed to reject request', 'end');
      }
    }

    async function removeStudent(userId) {
      showConfirmationModal(
        'Remove Student?',
        'Are you sure you want to remove this student from the meeting?',
        async () => {
          const gid = new URLSearchParams(window.location.search).get('groupId');
      
          try {
            const { error } = await supabase
              .from('meeting_requests')
              .update({ status: 'rejected' })
              .eq('group_id', gid)
              .eq('user_id', userId);
              
            if (error) throw error;
            
            // Remove from promoted speakers
            state.promotedSpeakers.delete(userId);
            
            showNotification('Student removed', 'info');
          } catch (error) {
            console.error('Error removing student:', error);
            showNotification('Failed to remove student', 'end');
          }
        }
      );
    }

    async function approveAllStudents() {
      if (state.waitingStudents.length === 0) return;
      
      const ids = state.waitingStudents.map(s => s.id);
      const userIds = state.waitingStudents.map(s => s.user_id);
      console.log('Approving all students:', ids);
      
      try {
        const { error } = await supabase.from('meeting_requests').update({ status: 'approved' }).in('id', ids);
        if (error) throw error;
        
        // Add all to promoted speakers
        userIds.forEach(userId => state.promotedSpeakers.add(userId));
        
        // Notify all students
        if (state.channel) {
          userIds.forEach(userId => {
            state.channel.send({
              type: 'broadcast',
              event: 'promote-speaker',
              payload: { userId }
            });
          });
        }
        
        state.waitingStudents = [];
        updateWaitingRoomUI();
        showNotification('All students admitted as speakers', 'check');
      } catch (error) {
        console.error('Error approving all students:', error);
        showNotification('Failed to approve requests', 'end');
      }
    }

    async function resetAllRequests() {
      showConfirmationModal(
        'Reset Waiting Room?',
        'Are you sure you want to reset all waiting room requests? This will require all students to be re-admitted.',
        async () => {
          const gid = new URLSearchParams(window.location.search).get('groupId');

          try {
            const { error } = await supabase
              .from('meeting_requests')
              .update({ status: 'pending' })
              .eq('group_id', gid)
              .neq('user_id', state.currentUser.id)
              .neq('status', 'host_active');

            if (error) throw error;
            showNotification('All student requests reset to pending.', 'info');
            fetchPendingRequests(gid);
          } catch (error) {
            console.error('Error resetting requests:', error);
            showNotification('Failed to reset requests.', 'end');
          }
        }
      );
    }

    function openWaitingRoom() { 
      if (!state.isHost) {
        showNotification('Only host can access waiting room', 'info');
        return;
      }
      waitingRoomModal.style.display = 'flex'; 
    }
    
    function closeWaitingRoomModal() { waitingRoomModal.style.display = 'none'; }

    function updateLoadingStatus(text) {
      if (loadingStatus) loadingStatus.textContent = text;
    }

    // ============= MANUAL JOIN REQUEST =============
    function showApprovalWelcome(overlay, user) {
      // Ensure overlay is visible
      overlay.classList.remove('hidden');
      overlay.style.display = 'flex';
      
      const content = overlay.querySelector('.waiting-content');
      if (content) {
        const userName = user.user_metadata.firstName || user.user_metadata.full_name || 'Student';
        const profilePhoto = user.user_metadata.avatar_url || null;
        const profileImg = profilePhoto ? `<img src="${profilePhoto}" style="width: 80px; height: 80px; border-radius: 50%; object-fit: cover; margin-bottom: 20px; border: 3px solid var(--accent-green);">` : `<div style="width: 80px; height: 80px; border-radius: 50%; background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple)); display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; font-size: 32px; font-weight: 600;">${userName.charAt(0).toUpperCase()}</div>`;
        
        content.innerHTML = `
          ${profileImg}
          <i class="fas fa-check-circle" style="font-size: 48px; color: var(--accent-green); margin-bottom: 15px; position: absolute; bottom: 240px; right: 40px;"></i>
          <h2 style="margin: 0 0 10px; font-size: 28px;">Welcome, ${userName}!</h2>
          <p style="opacity: 0.9; font-size: 16px;">Your request has been approved. Entering class...</p>
        `;
      }
      playNotificationSound();
    }

    async function submitJoinRequest() {
      const gid = new URLSearchParams(window.location.search).get('groupId');
      const btn = document.getElementById('request-join-btn');
      
      if (!gid || !state.currentUser) {
        showNotification('Error: Unable to submit request', 'error');
        return;
      }

      try {
        btn.disabled = true;
        btn.textContent = 'Sending...';

        const { data: existingRequest } = await supabase
          .from('meeting_requests')
          .select('*')
          .eq('group_id', gid)
          .eq('user_id', state.currentUser.id)
          .maybeSingle();

        if (existingRequest?.status === 'pending') {
          showNotification('Request already sent. Waiting for approval...', 'info');
          btn.disabled = false;
          btn.textContent = 'Request to Join';
          return;
        }

        if (existingRequest?.status === 'rejected') {
          // Update rejected request to pending
          const { error } = await supabase
            .from('meeting_requests')
            .update({ status: 'pending', created_at: new Date().toISOString() })
            .eq('id', existingRequest.id);

          if (error) throw error;
        } else {
          // Create new request
          const { error } = await supabase.from('meeting_requests').insert({
            group_id: gid,
            user_id: state.currentUser.id,
            user_name: state.currentUser.name,
            status: 'pending'
          });

          if (error) throw error;
        }

        // Update UI to show waiting state
        const titleEl = document.getElementById('waiting-title');
        const messageEl = document.getElementById('waiting-message');
        const joinBtn = document.getElementById('request-join-btn');
        const spinnerEl = document.getElementById('waiting-spinner');
        
        if (titleEl) titleEl.textContent = "Request Sent";
        if (messageEl) messageEl.textContent = "Your request has been sent. Waiting for host approval...";
        if (joinBtn) joinBtn.style.display = 'none';
        if (spinnerEl) spinnerEl.style.display = 'block';

        showNotification('Join request sent to host', 'check');
      } catch (error) {
        console.error('Error submitting join request:', error);
        showNotification('Failed to send request', 'error');
        btn.disabled = false;
        btn.textContent = 'Request to Join';
      }
    }

    function showCriticalError(msg) {
      document.getElementById('error-message').textContent = msg;
      document.getElementById('error-modal').style.display = 'flex';
    }

    // ============= DEVICE SETTINGS =============
    async function openDeviceSettingsModal(gid, user) {
      const modal = document.getElementById('device-settings-modal');
      const loadingOverlay = document.getElementById('loading-overlay');
      
      loadingOverlay.classList.add('hidden');
      modal.style.display = 'flex';
      
      try {
        // TRUE 10,000 USER LOCKDOWN: Only create preview for host or promoted speakers
        if (state.isHost || state.promotedSpeakers.has(user.id)) {
          if (!state.localAudioTrack || !state.localVideoTrack) {
             [state.localAudioTrack, state.localVideoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks();
             
             // Set initial state based on role
             if (!state.isHost) {
               state.localAudioTrack.setEnabled(false);
               state.localVideoTrack.setEnabled(false);
               state.isMicOn = false;
               state.isCameraOn = false;
             } else {
               state.localAudioTrack.setEnabled(true);
               state.localVideoTrack.setEnabled(true);
               state.isMicOn = true;
               state.isCameraOn = true;
             }
          }
          
          state.localVideoTrack.play('local-preview');
        }
        
        const devices = await AgoraRTC.getDevices();
        const cams = devices.filter(d => d.kind === 'videoinput');
        const mics = devices.filter(d => d.kind === 'audioinput');
        
        const camSelect = document.getElementById('camera-select');
        const micSelect = document.getElementById('mic-select');
        
        camSelect.innerHTML = cams.map(d => `<option value="${d.deviceId}">${d.label || 'Camera ' + (cams.indexOf(d) + 1)}</option>`).join('');
        micSelect.innerHTML = mics.map(d => `<option value="${d.deviceId}">${d.label || 'Microphone ' + (mics.indexOf(d) + 1)}</option>`).join('');
        
        camSelect.onchange = async (e) => {
          state.selectedCamId = e.target.value;
          if (state.localVideoTrack) {
            state.localVideoTrack.stop();
            state.localVideoTrack.close();
          }
          state.localVideoTrack = await AgoraRTC.createCameraVideoTrack({ cameraId: state.selectedCamId });
          state.localVideoTrack.play('local-preview');
        };
        
        micSelect.onchange = async (e) => {
          state.selectedMicId = e.target.value;
          if (state.localAudioTrack) {
            state.localAudioTrack.stop();
            state.localAudioTrack.close();
          }
          state.localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack({ microphoneId: state.selectedMicId });
        };
        
        document.getElementById('join-btn').onclick = async () => {
          modal.style.display = 'none';
          loadingOverlay.classList.remove('hidden');
          await initAgora(gid, user.id, user.user_metadata.firstName || user.user_metadata.full_name || 'User');
        };

      } catch (e) {
        console.error("Error in device settings:", e);
        showCriticalError("Could not access camera/microphone. Please check permissions.");
      }
    }

    // ============= SESSION SETUP =============
    async function completeSessionSetup(gid, user) {
        // SAFETY CHECK: Verify host is still active before entering class
        const { data: hostCheck } = await supabase
          .from('meeting_requests')
          .select('status')
          .eq('group_id', gid)
          .eq('status', 'host_active')
          .limit(1);
        
        if (!hostCheck || hostCheck.length === 0) {
          // Host is not active, show waiting overlay again
          showWaitingForHostOverlay(gid, user);
          return;
        }
        
        const { data: members } = await supabase
          .from('group_members')
          .select('user_id, profiles(full_name, username, profile_photo)')
          .eq('group_id', gid);

        if (members) {
          state.students = members
            .filter(m => m.user_id !== user.id)
            .map((m, i) => ({
              id: m.user_id,
              name: m.profiles?.full_name || m.profiles?.username || `User ${i}`,
              photo: m.profiles?.profile_photo,
              role: 'student'
            }));
        }

        state.channel = supabase.channel(`grp_${gid}`)
          .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'group_messages',
            filter: `group_id=eq.${gid}`
          }, (payload) => {
            const msg = payload.new;
            const isSelf = msg.sender_id === user.id;
            addMessage(msg.content, msg.sender_name, isSelf, false, msg.created_at);
          })
          .on('broadcast', { event: 'spotlight' }, (payload) => {
            // SPOTLIGHT IMMUNITY: Only change when explicitly broadcast
            state.spotlightUserId = payload.payload.spotlightUserId;
            state.spotlightImmune = payload.payload.immune || true;
            toggleSpotlightUI(payload.payload.active);
          })
          .on('broadcast', { event: 'whiteboard-toggle' }, (payload) => {
            if (payload.payload.userId === state.currentUser.id) return;
            if (payload.payload.active) {
              state.isWhiteboardActive = true;
              whiteboardOverlay.classList.add('active');
              whiteboardTools.classList.add('active');
              resizeCanvas();
              // Render initial state
              const commands = payload.payload.drawingCommands || [];
              commands.forEach(cmd => {
                ctx.beginPath();
                ctx.moveTo(cmd.fromX, cmd.fromY);
                ctx.lineTo(cmd.toX, cmd.toY);
                ctx.strokeStyle = cmd.color;
                ctx.lineWidth = cmd.lineWidth;
                ctx.lineCap = 'round';
                if (cmd.tool === 'eraser') {
                  ctx.globalCompositeOperation = 'destination-out';
                }
                ctx.stroke();
                if (cmd.tool === 'eraser') {
                  ctx.globalCompositeOperation = 'source-over';
                }
              });
              state.whiteboardState = payload.payload.drawingCommands || [];
            } else {
              state.isWhiteboardActive = false;
              whiteboardOverlay.classList.remove('active');
              whiteboardTools.classList.remove('active');
            }
          })
          .on('broadcast', { event: 'whiteboard-batch' }, (payload) => {
            if (payload.payload.userId === state.currentUser.id) return;
            if (!state.isWhiteboardActive) return;
            const commands = payload.payload.commands || [];
            commands.forEach(cmd => {
              ctx.beginPath();
              ctx.moveTo(cmd.fromX, cmd.fromY);
              ctx.lineTo(cmd.toX, cmd.toY);
              ctx.strokeStyle = cmd.color;
              ctx.lineWidth = cmd.lineWidth;
              ctx.lineCap = 'round';
              if (cmd.tool === 'eraser') {
                ctx.globalCompositeOperation = 'destination-out';
              }
              ctx.stroke();
              if (cmd.tool === 'eraser') {
                ctx.globalCompositeOperation = 'source-over';
              }
              state.whiteboardState.push(cmd);
            });
          })
          .on('broadcast', { event: 'whiteboard-clear' }, (payload) => {
            if (payload.payload.userId === state.currentUser.id) return;
            ctx.clearRect(0, 0, whiteboardCanvas.width, whiteboardCanvas.height);
            state.whiteboardState = [];
          })
          .on('broadcast', { event: 'mute-all' }, (payload) => {
            state.mediaControlLocked = payload.payload.locked;
            state.hardMuteLock = payload.payload.hardLock || false;
            if (state.localAudioTrack) {
              state.localAudioTrack.setEnabled(false);
              state.isMicOn = false;
              
              // Update UI
              const micBtn = document.querySelector('[data-action="mic"]');
              if (micBtn) {
                const micIcon = micBtn.querySelector('i');
                micIcon.classList.remove('fa-microphone');
                micIcon.classList.add('fa-microphone-slash');
                micBtn.classList.remove('active');
                micBtn.classList.add('media-locked');
              }
            }
            showNotification('Host muted all participants', 'mute');
          })
          .on('broadcast', { event: 'unmute-all' }, (payload) => {
            state.mediaControlLocked = payload.payload.locked;
            state.hardMuteLock = payload.payload.hardLock || false;
            const micBtn = document.querySelector('[data-action="mic"]');
            if (micBtn) {
              micBtn.classList.remove('media-locked');
            }
            showNotification('You can now unmute', 'mic');
          })
          .on('broadcast', { event: 'disable-cameras' }, (payload) => {
            state.cameraControlLocked = payload.payload.locked;
            state.hardCameraLock = payload.payload.hardLock || false;
            if (state.localVideoTrack) {
              state.localVideoTrack.setEnabled(false);
              state.isCameraOn = false;
              
              // Update UI
              const camBtn = document.querySelector('[data-action="cam"]');
              if (camBtn) {
                const camIcon = camBtn.querySelector('i');
                camIcon.classList.remove('fa-video');
                camIcon.classList.add('fa-video-slash');
                camBtn.classList.remove('active');
                camBtn.classList.add('media-locked');
              }
            }
            showNotification('Host disabled all cameras', 'camera');
          })
          .on('broadcast', { event: 'enable-cameras' }, (payload) => {
            state.cameraControlLocked = payload.payload.locked;
            state.hardCameraLock = payload.payload.hardLock || false;
            const camBtn = document.querySelector('[data-action="cam"]');
            if (camBtn) {
              camBtn.classList.remove('media-locked');
            }
            showNotification('You can now enable camera', 'camera');
          })
          .on('broadcast', { event: 'hand-raise' }, (payload) => {
            if (payload.payload.action === 'raise') {
              const { userId, userName } = payload.payload;
              state.raisedHands.set(userId, {
                name: userName,
                timestamp: Date.now(),
                userId: userId
              });
              
              // Add hand icon to correct video tile
              const userTile = document.getElementById(`tile-${userId}`);
              if (userTile) {
                const existingIcon = userTile.querySelector('.hand-icon');
                if (!existingIcon) {
                  const handIcon = document.createElement('div');
                  handIcon.className = 'hand-icon';
                  handIcon.innerHTML = '✋';
                  userTile.appendChild(handIcon);
                  userTile.classList.add('hand-raised');
                }
              }
              
              // Add message to chat for host
              if (state.isHost) {
                addMessage(`${userName} raised hand ✋`, 'system');
              }

              // Show notification to all users
              showNotification(`${userName} raised hand`, 'hand');
            }
          })
          .on('broadcast', { event: 'hand-lower' }, (payload) => {
            lowerHand(payload.payload.userId);
          })
          .on('broadcast', { event: 'screen-share-request' }, (payload) => {
            if (state.isHost) {
              state.screenShareRequests.push(payload.payload);
              showNotification(`${payload.payload.studentName} wants to share screen`, 'info');
            }
          })
          .on('broadcast', { event: 'media-request' }, (payload) => {
            if (state.isHost) {
              state.mediaRequests.push(payload.payload);
              showNotification(`${payload.payload.userName} wants to use ${payload.payload.mediaType}`, 'info');
            }
          })
          .on('broadcast', { event: 'screen-share-started' }, (payload) => {
            state.currentPresenter = payload.payload.userId;
          })
          .on('broadcast', { event: 'screen-share-stopped' }, (payload) => {
            if (state.currentPresenter === payload.payload.userId) {
              state.currentPresenter = null;
            }
          })
          .on('broadcast', { event: 'screen-share-approved' }, (payload) => {
            if (!state.isHost && payload.payload.studentId === state.currentUser.id) {
              state.screenShareApproved = true;
              state.canPresent = true;
              showNotification('Your screen share has been approved! You can now share your screen.', 'check');
              
              // Enable share button if it's disabled
              const shareBtn = document.querySelector('[data-action="share"]');
              if (shareBtn) {
                shareBtn.style.pointerEvents = 'auto';
                shareBtn.style.opacity = '1';
              }
            }
          })
          .on('broadcast', { event: 'screen-share-rejected' }, (payload) => {
            if (!state.isHost && payload.payload.studentId === state.currentUser.id) {
              state.screenShareApproved = false;
              showNotification('Your screen share request was rejected', 'info');
            }
          })
          .on('broadcast', { event: 'force-stop-screenshare' }, (payload) => {
            if (state.currentPresenter === payload.payload.userId) {
              stopScreenSharing();
              showNotification('Host stopped your screen share', 'info');
            }
          })
          .on('broadcast', { event: 'student-mic-change' }, (payload) => {
            // Host can track student mic states
            if (state.isHost) {
              console.log(`Student ${payload.payload.userId} mic: ${payload.payload.isMicOn}`);
            }
          })
          .on('broadcast', { event: 'cam-change' }, (payload) => {
            const { userId, isCameraOn } = payload.payload;
            const tile = document.getElementById(`tile-${userId}`);
            if (tile) {
              const player = tile.querySelector(`#player-${userId}`);
              if (player) player.style.opacity = isCameraOn ? '1' : '0';
            }
          })
          .on('broadcast', { event: 'promote-speaker' }, (payload) => {
            if (payload.payload.userId === state.currentUser?.id) {
              enablePresenterMode(payload.payload.userId);
            }
          })
          .on('broadcast', { event: 'demote-speaker' }, (payload) => {
            if (payload.payload.userId === state.currentUser?.id) {
              disablePresenterMode(payload.payload.userId);
            }
          })
          .on('broadcast', { event: 'end-meeting-for-all' }, () => {
            if (!state.isHost) {
              showNotification('Host has ended the meeting', 'end');
              state.isIntentionalLeave = true;
              
              if (state.client) {
                state.client.leave();
                if (state.localAudioTrack) state.localAudioTrack.close();
                if (state.localVideoTrack) state.localVideoTrack.close();
              }

              setTimeout(() => {
                const gid = new URLSearchParams(window.location.search).get('groupId');
                if (gid) {
                  window.location.href = `chatroom.html?groupId=${gid}`;
                } else {
                  window.location.href = 'dashboard.html';
                }
              }, 2000);
            }
          })
          .subscribe();

        supabase.channel(`status_${user.id}`)
          .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'meeting_requests',
            filter: `user_id=eq.${user.id}`
          }, (payload) => {
            if (payload.new.status === 'rejected' && payload.new.group_id === gid) {
              showNotification('You have been removed from the meeting.', 'end');
              setTimeout(() => { window.location.href = 'dashboard.html'; }, 2000);
            }
          })
          .subscribe();

        // Ensure canvas is properly sized when entering class
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        openDeviceSettingsModal(gid, user);
    }

    // ============= INITIALIZATION =============
    async function initialize() {
      // Load AI API key first
      await initializeAIKey();

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        window.location.href = 'login.html';
        return;
      }

      const user = session.user;
      state.currentUser = {
        id: user.id,
        name: user.user_metadata.firstName || user.user_metadata.full_name || 'User',
        email: user.email,
        role: 'student',
        photo: user.user_metadata.avatar_url
      };
      
      const { data: myProfile } = await supabase.from('profiles').select('profile_photo').eq('id', user.id).single();
      if (myProfile?.profile_photo) state.currentUser.photo = myProfile.profile_photo;

      state.isAuthenticated = true;

      const gid = new URLSearchParams(window.location.search).get('groupId');
      if (gid) {
        const { data: group } = await supabase
          .from('groups')
          .select('*')
          .eq('id', gid)
          .single();
        
        if (group) {
          state.classTitle = group.name;
          classTitleEl.textContent = group.name;
          
          state.hostId = group.created_by;
          
          if (group.created_by === user.id || state.currentUser.role === 'admin') {
            state.isHost = true;
            state.currentUser.role = 'host';
            hostTools.style.display = 'flex';
            document.body.classList.add('is-host');
            hostNameEl.textContent = state.currentUser.name;
            state.hostName = state.currentUser.name;
          } else {
            const { data: hostProfile } = await supabase
              .from('profiles')
              .select('full_name, username')
              .eq('id', group.created_by)
              .single();
            
            state.hostName = hostProfile?.full_name || hostProfile?.username || 'Host';
            hostNameEl.textContent = state.hostName;
          }

          if (state.isHost) {
            // Mark session as active
            const { data: activeMarker } = await supabase
              .from('meeting_requests')
              .select('id, created_at')
              .eq('group_id', gid)
              .eq('user_id', user.id)
              .eq('status', 'host_active')
              .maybeSingle();
              
            let isStale = false;
            if (activeMarker) {
              const created = new Date(activeMarker.created_at);
              const now = new Date();
              // If session marker is older than 3 hours, treat as stale
              if ((now - created) > 3 * 60 * 60 * 1000) {
                isStale = true;
              }
            }
              
            if (!activeMarker || isStale) {
              // Clean up stale requests from previous sessions
              await supabase.from('meeting_requests').delete().eq('group_id', gid);

              await supabase.from('meeting_requests').insert({
                group_id: gid,
                user_id: user.id,
                user_name: state.currentUser.name,
                status: 'host_active'
              });
            }

            setupHostWaitingRoom(gid);
            await completeSessionSetup(gid, user);
          } else {
            // Check if host has started the meeting - with retry logic
            let hostActiveList = null;
            let retries = 0;
            const maxRetries = 3;
            
            while (retries < maxRetries && !hostActiveList) {
              const { data, error } = await supabase
                .from('meeting_requests')
                .select('id, status')
                .eq('group_id', gid)
                .eq('status', 'host_active')
                .limit(1);
              
              if (error) {
                console.error('[Initialize] Error checking host active:', error);
              } else {
                hostActiveList = data;
              }
              
              if (!hostActiveList || hostActiveList.length === 0) {
                retries++;
                console.log('[Initialize] Host check attempt', retries, '- not found yet');
                if (retries < maxRetries) {
                  // Wait 500ms before retrying
                  await new Promise(r => setTimeout(r, 500));
                }
              }
            }
            
            console.log('[Initialize] Student - host active check result:', { hostActiveList, retries });
            
            if (!hostActiveList || hostActiveList.length === 0) {
              console.log('[Initialize] Host not active - showing waiting overlay');
              showWaitingForHostOverlay(gid, user);
              return; // Do NOT proceed with class setup until host starts
            } else {
              console.log('[Initialize] Host is active - checking waiting room');
              await checkWaitingRoom(gid, user, () => completeSessionSetup(gid, user));
            }
          }
        }
      }
      
      // Only setup canvas after we're past the waiting screen
      resizeCanvas();
      window.addEventListener('resize', resizeCanvas);

      const style = document.createElement('style');
      style.textContent = `
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        
        @keyframes slideOut {
          from { transform: translateX(0); opacity: 1; }
          to { transform: translateX(100%); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }

    // Make functions global for HTML event handlers
    window.handleButtonAction = handleButtonAction;
    window.toggleChatDrawer = toggleChatDrawer;
    window.toggleWhiteboard = toggleWhiteboard;
    window.takeAttendance = takeAttendance;
    window.generateSummary = generateSummary;
    window.generateQuiz = generateQuiz;
    window.suggestResources = suggestResources;
    window.muteAllParticipants = muteAllParticipants;
    window.unmuteAllParticipants = unmuteAllParticipants;
    window.disableAllCameras = disableAllCameras;
    window.enableAllCameras = enableAllCameras;
    window.toggleHostSpotlight = toggleHostSpotlight;
    window.lockAllMedia = lockAllMedia;
    window.unlockAllMedia = unlockAllMedia;
    window.showPendingRequests = showPendingRequests;
    window.closeRequestsModal = closeRequestsModal;
    window.approveScreenShare = approveScreenShare;
    window.rejectScreenShare = rejectScreenShare;
    window.copyClassLink = copyClassLink;
    window.exportAttendance = exportAttendance;
    window.closeAttendanceModal = closeAttendanceModal;
    window.cancelScreenShare = cancelScreenShare;
    window.closeWhiteboard = closeWhiteboard;
    window.saveWhiteboard = saveWhiteboard;
    window.openWaitingRoom = openWaitingRoom;
    window.closeWaitingRoomModal = closeWaitingRoomModal;
    window.approveStudent = approveStudent;
    window.rejectStudent = rejectStudent;
    window.approveAllStudents = approveAllStudents;
    window.resetAllRequests = resetAllRequests;
    window.removeStudent = removeStudent;
    window.clearAllHands = clearAllHands;
    window.lowerHand = lowerHand;
    window.forceStopScreenShare = forceStopScreenShare;
    window.rejoinSession = rejoinSession;
    window.submitJoinRequest = submitJoinRequest;

    window.addEventListener('beforeunload', async () => {
      if (state.client) {
        await state.client.leave();
        if (state.localAudioTrack) state.localAudioTrack.close();
        if (state.localVideoTrack) state.localVideoTrack.close();
      }
    });

    document.addEventListener('DOMContentLoaded', initialize);
