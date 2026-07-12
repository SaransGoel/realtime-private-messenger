import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';

// Replace the entire line with this (make sure you use YOUR specific Render URL)
const BACKEND_URL = 'https://realtime-private-messenger.onrender.com';
const socket = io(BACKEND_URL);

function App() {
  const [isConnected, setIsConnected] = useState(socket.connected);
  
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [currentUser, setCurrentUser] = useState(null);
  
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');

  const [users, setUsers] = useState([]);
  const [contacts, setContacts] = useState([]); // NEW: Store invitations/friendships
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [unreadCounts, setUnreadCounts] = useState({}); 
  const messagesEndRef = useRef(null);

  // Connection & User Lists
  useEffect(() => {
    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));
    socket.on('user_status_changed', fetchUsers);
    return () => {
      socket.off('connect'); socket.off('disconnect'); socket.off('user_status_changed');
    };
  }, []);

  // NEW: Real-Time Invitation Listener
  useEffect(() => {
    socket.on('contact_updated', (updatedContact) => {
      setContacts(prev => {
        if (updatedContact.status === 'none') {
            return prev.filter(c => c.id !== updatedContact.id); // Remove rejected invite
        }
        const exists = prev.find(c => c.id === updatedContact.id);
        if (exists) return prev.map(c => c.id === updatedContact.id ? updatedContact : c);
        return [...prev, updatedContact];
      });
    });
    return () => socket.off('contact_updated');
  }, []);

  // Chat Message Listener
  useEffect(() => {
    const handleReceiveMsg = (message) => {
      if (!currentUser) return;
      
      const isRelatedToCurrentChat = selectedUser && (
        (message.sender_id === currentUser.id && message.receiver_id === selectedUser.id) ||
        (message.sender_id === selectedUser.id && message.receiver_id === currentUser.id)
      );
      
      if (isRelatedToCurrentChat) setMessages((prev) => [...prev, message]);
      else if (message.receiver_id === currentUser.id) {
        setUnreadCounts(prev => ({ ...prev, [message.sender_id]: (prev[message.sender_id] || 0) + 1 }));
      }
    };
    socket.on('receive_private_message', handleReceiveMsg);
    return () => socket.off('receive_private_message', handleReceiveMsg);
  }, [currentUser, selectedUser]);

  // Load chat history only if users are connected
  useEffect(() => {
    const relationship = selectedUser ? getContactInfo(selectedUser.id).status : 'none';
    if (currentUser && selectedUser && !isEditingProfile && relationship === 'accepted') {
      ${BACKEND_URL}`${BACKEND_URL}/api/messages/${currentUser.id}/${selectedUser.id}`)
        .then(res => res.json())
        .then(data => setMessages(data))
        .catch(err => console.error(err));
    } else {
      setMessages([]); // Clear chat box if not accepted yet
    }
  }, [currentUser, selectedUser, isEditingProfile]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchUsers = () => {
    ${BACKEND_URL}'${BACKEND_URL}/api/users').then(res => res.json()).then(data => setUsers(data));
  };

  const fetchContacts = (userId) => {
    ${BACKEND_URL}`${BACKEND_URL}/api/contacts/${userId}`).then(res => res.json()).then(data => setContacts(data));
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    if (!usernameInput.trim() || !passwordInput.trim()) return alert("Fields required.");
    const endpoint = isLoginMode ? '/api/login' : '/api/register';
    try {
      const response = await ${BACKEND_URL}`${BACKEND_URL}${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usernameInput, password: passwordInput }),
      });
      const data = await response.json();
      if (response.ok) {
        setCurrentUser(data);
        socket.emit('register_user', data.id);
        fetchUsers();
        fetchContacts(data.id); // Load their contacts on login
      } else alert(data.error); 
    } catch (error) { alert("Server error."); }
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    if (!editUsername.trim() || !editPassword.trim()) return alert("Fields cannot be empty.");
    try {
      const res = await ${BACKEND_URL}`${BACKEND_URL}/api/users/${currentUser.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: editUsername, password: editPassword })
      });
      const data = await res.json();
      if (res.ok) {
        alert("Profile updated successfully!");
        setCurrentUser({ ...currentUser, username: data.username });
        setIsEditingProfile(false);
      } else alert(data.error);
    } catch (error) { alert("Failed to update profile."); }
  };

  const handleLogout = () => {
      socket.disconnect(); 
      setCurrentUser(null); setSelectedUser(null); setIsEditingProfile(false);
      setUsernameInput(''); setPasswordInput('');
      setTimeout(() => socket.connect(), 500); 
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedUser) return;
    socket.emit('send_private_message', { sender_id: currentUser.id, receiver_id: selectedUser.id, content: newMessage });
    setNewMessage('');
  };

  const handleUserSelect = (u) => {
    setSelectedUser(u); setIsEditingProfile(false);
    setUnreadCounts(prev => ({ ...prev, [u.id]: 0 })); 
  };

  const openEditProfile = () => {
    setEditUsername(currentUser.username); setEditPassword('');
    setIsEditingProfile(true); setSelectedUser(null);
  };

  // Helper function to check the relationship between the logged-in user and another user
  const getContactInfo = (otherUserId) => {
    const contact = contacts.find(c => 
        (c.sender_id === currentUser.id && c.receiver_id === otherUserId) || 
        (c.sender_id === otherUserId && c.receiver_id === currentUser.id)
    );
    if (!contact) return { status: 'none', contact: null };
    if (contact.status === 'accepted') return { status: 'accepted', contact };
    if (contact.sender_id === currentUser.id) return { status: 'pending_sent', contact };
    return { status: 'pending_received', contact };
  };

  // Invitation Handlers
  const sendInvite = (receiverId) => socket.emit('send_invite', { sender_id: currentUser.id, receiver_id: receiverId });
  const updateInvite = (contactId, status, senderId, receiverId) => socket.emit('update_invite', { contact_id: contactId, status, sender_id: senderId, receiver_id: receiverId });

  // UI: Authentication Screen
  if (!currentUser) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '100px', fontFamily: 'sans-serif' }}>
        <h2>{isLoginMode ? 'Login to Chat' : 'Create an Account'}</h2>
        <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '300px' }}>
          <input type="text" placeholder="Username" value={usernameInput} onChange={(e) => setUsernameInput(e.target.value)} style={{ padding: '10px', fontSize: '16px', borderRadius: '4px', border: '1px solid #ccc' }} />
          <input type="password" placeholder="Password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} style={{ padding: '10px', fontSize: '16px', borderRadius: '4px', border: '1px solid #ccc' }} />
          <button type="submit" style={{ padding: '10px', fontSize: '16px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>{isLoginMode ? 'Login' : 'Sign Up'}</button>
        </form>
        <p style={{ marginTop: '15px', cursor: 'pointer', color: '#007bff', textDecoration: 'underline' }} onClick={() => setIsLoginMode(!isLoginMode)}>
          {isLoginMode ? "Don't have an account? Sign up here." : "Already have an account? Login here."}
        </p>
      </div>
    );
  }

  // Get the relationship status for the currently clicked user
  const currentRelationship = selectedUser ? getContactInfo(selectedUser.id) : { status: 'none', contact: null };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '85vh', maxWidth: '1000px', margin: '40px auto', fontFamily: 'sans-serif', border: '1px solid #444', borderRadius: '8px', overflow: 'hidden', backgroundColor: '#1e1e1e', color: 'white' }}>
      
      {/* GLOBAL TOP BAR */}
      <div style={{ padding: '15px 20px', backgroundColor: '#252526', borderBottom: '1px solid #444', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <h2 style={{ margin: 0, color: '#007bff' }}>PrivateChat</h2>
          <div style={{ height: '24px', width: '1px', backgroundColor: '#444' }}></div>
          <div>
            <span style={{ fontWeight: 'bold', fontSize: '18px' }}>{currentUser.username}</span>
            <span style={{ marginLeft: '10px', fontSize: '12px', color: '#4caf50' }}>🟢 Online</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={openEditProfile} style={{ padding: '8px 16px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Edit Profile</button>
          <button onClick={handleLogout} style={{ padding: '8px 16px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Logout</button>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        
        {/* LEFT PANE: Sidebar List of ALL users */}
        <div style={{ width: '30%', backgroundColor: '#2b2b2c', borderRight: '1px solid #444', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '15px', backgroundColor: '#1e1e1e', borderBottom: '1px solid #444', fontWeight: 'bold', color: '#aaa', fontSize: '14px' }}>All Users</div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {users.filter(u => u.id !== currentUser.id).map(u => {
              const { status } = getContactInfo(u.id);
              return (
                <div key={u.id} onClick={() => handleUserSelect(u)}
                  style={{ 
                    padding: '15px', borderBottom: '1px solid #333', cursor: 'pointer',
                    backgroundColor: selectedUser?.id === u.id && !isEditingProfile ? '#007bff' : 'transparent',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: selectedUser?.id === u.id && !isEditingProfile ? 'bold' : 'normal' }}>{u.username}</span>
                    {unreadCounts[u.id] > 0 && <span style={{ backgroundColor: '#dc3545', color: 'white', borderRadius: '50%', padding: '2px 7px', fontSize: '11px', fontWeight: 'bold' }}>{unreadCounts[u.id]}</span>}
                  </div>
                  {/* Status Indicator Icon in Sidebar */}
                  <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                    {status === 'pending_received' && <span>🔔</span>}
                    {status === 'accepted' && <span>🤝</span>}
                    <span style={{opacity: 0.5}}>{u.is_online ? '🟢' : '⚪'}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* RIGHT PANE: Dynamic View */}
        <div style={{ width: '70%', display: 'flex', flexDirection: 'column', backgroundColor: '#1e1e1e' }}>
          
          {isEditingProfile ? (
            // Profile Edit Form
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
              <h2>Update Your Profile</h2>
              <form onSubmit={handleUpdateProfile} style={{ display: 'flex', flexDirection: 'column', gap: '15px', width: '300px', marginTop: '20px' }}>
                <input type="text" value={editUsername} onChange={(e) => setEditUsername(e.target.value)} style={{ padding: '10px', borderRadius: '4px', border: '1px solid #555', backgroundColor: '#333', color: 'white' }} />
                <input type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="Enter new password" style={{ padding: '10px', borderRadius: '4px', border: '1px solid #555', backgroundColor: '#333', color: 'white' }} />
                <button type="submit" style={{ padding: '12px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Save Changes</button>
              </form>
            </div>
          ) : selectedUser ? (
            // Contact Relationship Views
            <>
              <div style={{ padding: '20px', borderBottom: '1px solid #444', backgroundColor: '#252526' }}>
                <h3 style={{ margin: 0 }}>{selectedUser.username}</h3>
              </div>
              
              <div style={{ flex: 1, padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center', justifyContent: currentRelationship.status === 'accepted' ? 'flex-start' : 'center' }}>
                
                {/* View 1: Not connected yet */}
                {currentRelationship.status === 'none' && (
                  <div style={{ textAlign: 'center' }}>
                    <h2 style={{ color: '#ccc' }}>Connect with {selectedUser.username}</h2>
                    <p style={{ color: '#888', marginBottom: '20px' }}>You must send an invitation to start chatting.</p>
                    <button onClick={() => sendInvite(selectedUser.id)} style={{ padding: '10px 20px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                      Send Invitation
                    </button>
                  </div>
                )}

                {/* View 2: Sent invite, waiting for them */}
                {currentRelationship.status === 'pending_sent' && (
                  <div style={{ textAlign: 'center', color: '#888' }}>
                    <h2>⏳ Invitation Sent</h2>
                    <p>Waiting for {selectedUser.username} to accept your request.</p>
                  </div>
                )}

                {/* View 3: They sent an invite, waiting for YOU */}
                {currentRelationship.status === 'pending_received' && (
                  <div style={{ textAlign: 'center', backgroundColor: '#333', padding: '30px', borderRadius: '8px' }}>
                    <h2 style={{ margin: '0 0 10px 0' }}>🔔 Chat Request</h2>
                    <p style={{ margin: '0 0 20px 0' }}>{selectedUser.username} wants to connect with you.</p>
                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                      <button onClick={() => updateInvite(currentRelationship.contact.id, 'accepted', currentRelationship.contact.sender_id, currentRelationship.contact.receiver_id)} style={{ padding: '10px 20px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Accept</button>
                      <button onClick={() => updateInvite(currentRelationship.contact.id, 'rejected', currentRelationship.contact.sender_id, currentRelationship.contact.receiver_id)} style={{ padding: '10px 20px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Decline</button>
                    </div>
                  </div>
                )}

                {/* View 4: Accepted (Normal Chat UI) */}
                {currentRelationship.status === 'accepted' && (
                  <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {messages.map((msg, index) => (
                      <div key={index} style={{ 
                        alignSelf: msg.sender_id === currentUser.id ? 'flex-end' : 'flex-start',
                        backgroundColor: msg.sender_id === currentUser.id ? '#007bff' : '#444',
                        padding: '10px 15px', borderRadius: '15px', maxWidth: '70%'
                      }}>
                        <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '4px' }}>
                          {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </div>
                        <div>{msg.content}</div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              {/* Only show the text input box if they are accepted friends */}
              {currentRelationship.status === 'accepted' && (
                <form onSubmit={handleSendMessage} style={{ padding: '20px', borderTop: '1px solid #444', display: 'flex', gap: '10px', backgroundColor: '#252526' }}>
                  <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Type a message..." style={{ flex: 1, padding: '10px', borderRadius: '4px', border: '1px solid #555', backgroundColor: '#333', color: 'white' }} />
                  <button type="submit" style={{ padding: '10px 20px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Send</button>
                </form>
              )}
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#888' }}>
              <h2>Select a user from the sidebar</h2>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;