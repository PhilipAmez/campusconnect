// socketSetup.js
export const socket = io('https://campusconnect-omep.onrender.com', { autoConnect: false });

export function setupSocketEvents(groupId, currentUser, onMessage, onTyping) {
  socket.connect();

  socket.on('connect', () => {
    socket.emit('join_group', groupId, currentUser.name);
  });

  socket.on('new_message', onMessage);

  socket.on('user_typing', (user) => {
    if (onTyping) onTyping(user);
  });

  socket.on('user_joined', (user) => {
    console.log(`${user} joined the group`);
  });

  socket.on('disconnect', () => {
    console.warn('⚠️ Disconnected from chat server.');
  });

  socket.io.on('reconnect', () => {
    console.log('✅ Reconnected to chat server');
    socket.emit('join_group', groupId, currentUser.name);
  });
}

export function emitTyping(groupId, user) {
  socket.emit('typing', { groupId, user });
}

export function emitMessage(groupId, messageData) {
  socket.emit('group:message', { groupId, message: messageData });
}

export async function triggerPeerPalAI(groupId, prompt) {
  const response = await fetch('/api/peerpal-reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupId, prompt }),
  });

  const { reply } = await response.json();
  emitPeerPalReply(groupId, reply);
}

export function emitPeerPalReply(groupId, replyText) {
  emitMessage(groupId, {
    sender: {
      id: 'peerpal-bot',
      name: 'PeerPal 🤖',
      isBot: true,
    },
    message: replyText,
    timestamp: Date.now(),
  });
}

// ChatInput.jsx
function ChatInput({ groupId, currentUser, currentGroupUsers }) {
  const [message, setMessage] = useState('');
  const [mentionList, setMentionList] = useState([]);
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);

  const handleInputChange = (e) => {
    const text = e.target.value;
    setMessage(text);

    if (text.endsWith('@')) {
      setMentionList(currentGroupUsers);
      setShowMentionDropdown(true);
    } else {
      setShowMentionDropdown(false);
    }
  };

  const handleMentionClick = (name) => {
    setMessage((prev) => prev + name + ' ');
    setShowMentionDropdown(false);
  };

  const handleSend = async () => {
    const isPeerPalTrigger = message.includes('@PeerPal Ai');
    const payload = {
      sender: currentUser,
      message,
      timestamp: Date.now(),
    };

    emitMessage(groupId, payload);
    setMessage('');

    if (isPeerPalTrigger) {
      await triggerPeerPalAI(groupId, message);
    }
  };

  return (
    <div>
      <input
        value={message}
        onChange={handleInputChange}
        placeholder="Type a message..."
      />
      {showMentionDropdown && (
        <ul className="mention-dropdown">
          {mentionList.map((user) => (
            <li key={user.id} onClick={() => handleMentionClick(user.name)}>
              @{user.name}
            </li>
          ))}
        </ul>
      )}
      <button onClick={handleSend}>Send</button>
    </div>
  );
}

export default ChatInput;
