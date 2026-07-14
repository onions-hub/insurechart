import { useState, useEffect, useRef } from 'react';
import { 
  Search, Folder, FolderOpen, FileText, Plus, ChevronRight, 
  Upload, Calendar, User, Clock, ExternalLink, File, 
  FileSpreadsheet, FileImage, ShieldAlert, CheckCircle2, 
  Info, Check, RefreshCw, BarChart2, BookOpen, Settings,
  Globe, Laptop, LogIn, MapPin, Contact, Map, ArrowLeft, Edit2
} from 'lucide-react';
import {
  loadGoogleApiScripts,
  initGoogleClients,
  loginToGoogle,
  isGoogleConnected,
  scanCloudCustomers,
  getCloudCustomerDetails,
  saveCloudLog,
  uploadFileToCloudFolder,
  createCloudCustomer,
  updateCloudCustomerProfile,
  createCalendarEvent
} from './googleDriveService';
import './App.css';

// Google Map Sub-component
const MapComponent = ({ customers, apiKey, onSelectCustomer }) => {
  const mapRef = useRef(null);

  useEffect(() => {
    if (!apiKey) return;

    if (!window.google || !window.google.maps) {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
      script.async = true;
      script.defer = true;
      script.onload = initMap;
      document.head.appendChild(script);
    } else {
      initMap();
    }

    function initMap() {
      if (!mapRef.current || !window.google) return;
      
      const map = new google.maps.Map(mapRef.current, {
        center: { lat: 37.5665, lng: 126.9780 }, // Default center: Seoul
        zoom: 12,
        mapTypeControl: false,
        fullscreenControl: false
      });

      // User location marker
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const pos = {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            };
            map.setCenter(pos);
            map.setZoom(14);
            
            new google.maps.Marker({
              position: pos,
              map: map,
              title: "내 현재 위치",
              icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 8,
                fillColor: "#3498db",
                fillOpacity: 1,
                strokeColor: "#ffffff",
                strokeWeight: 2,
              }
            });
          }
        );
      }

      // Plot customer markers
      const geocoder = new google.maps.Geocoder();
      customers.forEach((cust, idx) => {
        if (!cust.address) return;

        // Stagger to prevent GDrive/Maps API request overflow
        setTimeout(() => {
          geocoder.geocode({ address: cust.address }, (results, status) => {
            if (status === 'OK' && results[0]) {
              const marker = new google.maps.Marker({
                position: results[0].geometry.location,
                map: map,
                title: cust.name,
                animation: google.maps.Animation.DROP
              });

              // Expose select callback to global scope for info windows
              window.selectCustomerFromMap = (category, name) => {
                onSelectCustomer(category, name);
              };

              const infoWindow = new google.maps.InfoWindow({
                content: `
                  <div style="padding: 10px; font-family: sans-serif; color: #1a252f; line-height: 1.4;">
                    <h4 style="margin: 0 0 6px 0; font-size: 13.5px; font-weight: 700; color: #2c3e50;">${cust.name} 고객</h4>
                    <p style="margin: 0 0 8px 0; font-size: 11px; color: #7f8c8d;">${cust.address}</p>
                    <p style="margin: 0 0 8px 0; font-size: 11px; color: #7f8c8d;">생일: ${cust.birthday || '미입력'} | 계약일: ${cust.contractDate || '미입력'}</p>
                    <div style="font-size: 11px; font-weight: 700; color: #2ecc71; cursor: pointer; text-decoration: underline;" 
                         onclick="window.selectCustomerFromMap('${cust.category}', '${cust.name}')">상담 차트 열기 &rarr;</div>
                  </div>
                `
              });

              marker.addListener('click', () => {
                infoWindow.open(map, marker);
              });
            }
          });
        }, idx * 150);
      });
    }
  }, [customers, apiKey, onSelectCustomer]);

  if (!apiKey) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'hsl(var(--text-muted))' }}>
        구글 지도 API를 연동하려면 우측 상단 톱니바퀴를 눌러 [구글 API Key]를 먼저 등록해 주세요.
      </div>
    );
  }

  return (
    <div className="map-container">
      <div ref={mapRef} id="google-map"></div>
      <div className="map-sidebar-info">
        <h3>📍 내 주변 고객 지도</h3>
        <p style={{ fontSize: '11px', color: 'hsl(var(--text-muted))', lineHeight: '1.4' }}>
          주소가 등록된 고객들이 지도상에 자동 매핑됩니다. 내 GPS 위치 주변의 고객을 찾아 터치 영업을 진행해 보세요.
        </p>
      </div>
    </div>
  );
};

function App() {
  // Check if viewing shared digital business card
  const [sharedCardData, setSharedCardData] = useState(null);
  
  // Connection Settings
  const [connectionMode, setConnectionMode] = useState(() => {
    return localStorage.getItem('insurechart_mode') || 'local';
  });
  const [clientId, setClientId] = useState(() => {
    return localStorage.getItem('insurechart_client_id') || '';
  });
  const [apiKey, setApiKey] = useState(() => {
    return localStorage.getItem('insurechart_api_key') || '';
  });
  const [isCloudConnected, setIsCloudConnected] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Active Workspace Tab
  const [activeTab, setActiveTab] = useState('chart'); // chart | map | card

  // App Data State
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerDetails, setCustomerDetails] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailsLoading, setIsDetailsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  // Modals & Forms
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState({});

  // Client Registration Form State
  const [registerForm, setRegisterForm] = useState({
    name: '',
    category: 'ㄱ',
    address: '',
    birthday: '',
    contractDate: '',
    syncCalendarBirthday: false,
    syncCalendarContract: false
  });

  // Client Profile Edit State
  const [profileEditForm, setProfileEditForm] = useState({
    address: '',
    birthday: '',
    contractDate: ''
  });

  // Digital Business Card Builder State
  const [cardFlipped, setCardFlipped] = useState(false);
  const [cardData, setCardData] = useState(() => {
    const saved = localStorage.getItem('insurechart_card');
    return saved ? JSON.parse(saved) : {
      name: '',
      title: '보험 설계사',
      company: '광북금융솔루션',
      phone: '',
      email: '',
      kakaoLink: '',
      specialty: '보장분석, 실손의료비, 암/종합보험 설계',
      motto: '고객의 자산을 내 자산처럼 성실히 관리합니다.'
    };
  });

  // Consultation Log Form State
  const [logForm, setLogForm] = useState({
    date: new Date().toISOString().split('T')[0],
    type: '장기보험',
    inquiry: '',
    analysis: '',
    proposal: '',
    postPlan: '',
    files: []
  });

  // File Upload State
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const categories = ['ALL', 'ㄱ', 'ㄴ~ㅅ', 'ㅇ', 'ㅈ~ㅎ', '#기업', '#소개고객'];

  // Check URL query parameters for shared business card
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cardParam = params.get('card');
    if (cardParam) {
      try {
        const decoded = JSON.parse(decodeURIComponent(atob(cardParam)));
        setSharedCardData(decoded);
      } catch (e) {
        console.error('Failed to parse shared business card data', e);
      }
    }
  }, []);

  // Auto-dismiss toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Load clients based on connection mode
  useEffect(() => {
    if (connectionMode === 'cloud') {
      setupGoogleClients();
    } else {
      fetchCustomers();
    }
  }, [connectionMode]);

  // Set up Google SDK Clients
  const setupGoogleClients = async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (!clientId || !apiKey) {
        setShowSettings(true);
        throw new Error('구글 클라우드 연동을 위해 [OAuth Client ID]와 [API Key]를 등록해야 합니다.');
      }
      
      await loadGoogleApiScripts();
      await initGoogleClients(clientId, apiKey, (token) => {
        setIsCloudConnected(true);
        showToast('success', '구글 계정 연결 완료.');
      });

      if (isGoogleConnected()) {
        setIsCloudConnected(true);
        fetchCloudCustomersList();
      } else {
        setIsLoading(false);
      }
    } catch (err) {
      console.error(err);
      setError(err.message || '구글 API 초기화에 실패했습니다.');
      setIsLoading(false);
    }
  };

  // Google Login popup trigger
  const handleGoogleLogin = async () => {
    try {
      setIsLoading(true);
      await loginToGoogle();
      setIsCloudConnected(true);
      await fetchCloudCustomersList();
    } catch (err) {
      console.error(err);
      showToast('error', '구글 계정 로그인 실패.');
      setIsLoading(false);
    }
  };

  const fetchCustomers = async () => {
    if (connectionMode === 'cloud') {
      if (isCloudConnected) {
        fetchCloudCustomersList();
      } else {
        handleGoogleLogin();
      }
    } else {
      fetchLocalCustomersList();
    }
  };

  const fetchLocalCustomersList = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/customers');
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.msg || '로컬 서버 에러');
      }
      const data = await res.json();
      setCustomers(data);
    } catch (err) {
      console.error(err);
      setError(err.message || '로컬 서버 연결에 실패했습니다. 메인 PC에서 InsureChart 서버가 작동 중인지 확인해 주세요.');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchCloudCustomersList = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await scanCloudCustomers();
      setCustomers(data);
      showToast('success', '구글 클라우드 동기화 완료!');
    } catch (err) {
      console.error(err);
      setError(err.message || '구글 드라이브 스캔 실패.');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchCustomerDetails = async (customer) => {
    setIsDetailsLoading(true);
    try {
      if (connectionMode === 'cloud') {
        const data = await getCloudCustomerDetails(customer.folderId);
        setCustomerDetails({
          name: customer.name,
          category: customer.category,
          path: `Google Drive > 01_장기보험_고객관리 > ${customer.category} > ${customer.name}`,
          files: data.files,
          logs: data.logs,
          profile: data.profile || { name: customer.name, category: customer.category, address: '', birthday: '', contractDate: '' }
        });
      } else {
        const res = await fetch(`/api/customers/details?category=${encodeURIComponent(customer.category)}&name=${encodeURIComponent(customer.name)}`);
        if (!res.ok) throw new Error('상세 로드 실패');
        const data = await res.json();
        setCustomerDetails(data);
      }
      setSelectedCustomer(customer);
      setLogForm({
        date: new Date().toISOString().split('T')[0],
        type: '장기보험',
        inquiry: '',
        analysis: '',
        proposal: '',
        postPlan: '',
        files: []
      });
    } catch (err) {
      console.error(err);
      showToast('error', '고객 정보를 불러올 수 없습니다.');
    } finally {
      setIsDetailsLoading(false);
    }
  };

  const showToast = (type, text) => {
    setToast({ type, text });
  };

  // Add customer callback from Map view info window
  const handleSelectCustomerFromMap = (category, name) => {
    const cust = customers.find(c => c.category === category && c.name === name);
    if (cust) {
      fetchCustomerDetails(cust);
    }
  };

  // Auto calculate Hangul category folders
  const getHangulCategory = (name) => {
    const char = name[0] || '';
    const code = char.charCodeAt(0) - 0xAC00;
    if (code > -1 && code < 11172) {
      const choIndex = Math.floor(code / 588);
      const choList = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
      const cho = choList[choIndex];
      if (['ㄱ', 'ㄲ'].includes(cho)) return 'ㄱ';
      if (['ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ'].includes(cho)) return 'ㄴ~ㅅ';
      if (['ㅇ'].includes(cho)) return 'ㅇ';
      return 'ㅈ~ㅎ'; // ㅈ, ㅉ, ㅊ, ㅋ, ㅌ, ㅍ, ㅎ
    }
    return '#소개고객'; // Fallback
  };

  // Handle Client Registration
  const handleRegisterCustomer = async (e) => {
    e.preventDefault();
    if (!registerForm.name.trim()) {
      showToast('error', '이름을 입력해 주세요.');
      return;
    }

    setIsLoading(true);
    try {
      const autoCat = getHangulCategory(registerForm.name);
      const finalCategory = registerForm.category || autoCat;

      if (connectionMode === 'cloud') {
        const newCust = await createCloudCustomer(
          registerForm.name,
          finalCategory,
          registerForm.address,
          registerForm.birthday,
          registerForm.contractDate
        );

        // Sync to Google Calendar if requested
        if (registerForm.syncCalendarBirthday && registerForm.birthday) {
          await createCalendarEvent(
            `🎂 [${registerForm.name}] 고객 생일`,
            `InsureChart 기념일 자동 동기화\n고객명: ${registerForm.name}`,
            registerForm.birthday
          );
        }
        if (registerForm.syncCalendarContract && registerForm.contractDate) {
          await createCalendarEvent(
            `📜 [${registerForm.name}] 보험 계약일`,
            `InsureChart 기념일 자동 동기화\n고객명: ${registerForm.name}`,
            registerForm.contractDate
          );
        }

        showToast('success', '클라우드에 신규 고객 폴더 및 프로필 생성이 완료되었습니다!');
      } else {
        const res = await fetch('/api/customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: registerForm.name,
            category: finalCategory,
            address: registerForm.address,
            birthday: registerForm.birthday,
            contractDate: registerForm.contractDate
          })
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || '고객 등록 실패');
        }
        showToast('success', '로컬 폴더에 신규 고객 카드가 정상 생성되었습니다!');
      }

      setShowRegisterModal(false);
      // Reset Form
      setRegisterForm({
        name: '',
        category: 'ㄱ',
        address: '',
        birthday: '',
        contractDate: '',
        syncCalendarBirthday: false,
        syncCalendarContract: false
      });

      // Refresh customers list
      await fetchCustomers();
    } catch (err) {
      console.error(err);
      showToast('error', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Open Edit Profile modal
  const handleOpenEditProfile = () => {
    if (!customerDetails) return;
    setProfileEditForm({
      address: customerDetails.profile.address || '',
      birthday: customerDetails.profile.birthday || '',
      contractDate: customerDetails.profile.contractDate || ''
    });
    setShowEditProfileModal(true);
  };

  // Edit customer profile
  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!selectedCustomer || !customerDetails) return;

    try {
      if (connectionMode === 'cloud') {
        const updated = await updateCloudCustomerProfile(selectedCustomer.folderId, profileEditForm, customerDetails);
        setCustomerDetails(prev => ({
          ...prev,
          profile: updated
        }));
        showToast('success', '구글 클라우드 프로필을 갱신하였습니다.');
      } else {
        const res = await fetch('/api/customers/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: selectedCustomer.category,
            name: selectedCustomer.name,
            profile: profileEditForm
          })
        });

        if (!res.ok) throw new Error('프로필 갱신 실패');
        const data = await res.json();
        setCustomerDetails(prev => ({
          ...prev,
          profile: data.profile
        }));
        showToast('success', '로컬 고객 프로필이 성공적으로 업데이트되었습니다!');
      }

      setShowEditProfileModal(false);
      fetchCustomers(); // refresh cached profiles
    } catch (err) {
      console.error(err);
      showToast('error', err.message);
    }
  };

  // Sync to calendar individually
  const handleSyncBirthdayToCalendar = async () => {
    if (!customerDetails || !customerDetails.profile.birthday) return;
    try {
      await createCalendarEvent(
        `🎂 [${customerDetails.name}] 고객 생일`,
        `InsureChart 기념일 동기화\n고객명: ${customerDetails.name}`,
        customerDetails.profile.birthday
      );
      showToast('success', '구글 캘린더에 고객 생일을 등록했습니다.');
    } catch (e) {
      showToast('error', '캘린더 등록에 실패했습니다. 구글 계정이 연동되었는지 확인해 주세요.');
    }
  };

  const handleSyncContractToCalendar = async () => {
    if (!customerDetails || !customerDetails.profile.contractDate) return;
    try {
      await createCalendarEvent(
        `📜 [${customerDetails.name}] 보험 계약일`,
        `InsureChart 기념일 동기화\n고객명: ${customerDetails.name}`,
        customerDetails.profile.contractDate
      );
      showToast('success', '구글 캘린더에 보험 계약 기념일을 등록했습니다.');
    } catch (e) {
      showToast('error', '캘린더 등록에 실패했습니다. 구글 계정이 연동되었는지 확인해 주세요.');
    }
  };

  // Save Log
  const handleSaveLog = async (e) => {
    e.preventDefault();
    if (!selectedCustomer || !customerDetails) return;

    if (!logForm.inquiry.trim() && !logForm.analysis.trim() && !logForm.proposal.trim()) {
      showToast('error', '상담 내용 중 최소 한 개의 항목은 입력해야 합니다.');
      return;
    }

    try {
      if (connectionMode === 'cloud') {
        const newLogEntry = {
          id: Date.now().toString(),
          date: logForm.date || new Date().toISOString().split('T')[0],
          type: logForm.type || '일반상담',
          inquiry: logForm.inquiry || '',
          analysis: logForm.analysis || '',
          proposal: logForm.proposal || '',
          postPlan: logForm.postPlan || '',
          files: logForm.files || []
        };
        const updatedLogs = await saveCloudLog(selectedCustomer.folderId, customerDetails.logs, newLogEntry, selectedCustomer.name, customerDetails.profile);
        setCustomerDetails(prev => ({ ...prev, logs: updatedLogs }));
        showToast('success', '구글 클라우드에 일지를 저장했습니다!');
      } else {
        const res = await fetch('/api/customers/logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: selectedCustomer.category,
            name: selectedCustomer.name,
            log: logForm
          })
        });

        if (!res.ok) throw new Error('상담 일지를 저장하는데 실패했습니다.');
        const data = await res.json();
        setCustomerDetails(prev => ({ ...prev, logs: data.logs }));
        showToast('success', '로컬 차트에 상담 기록이 추가되었습니다!');
      }

      fetchCustomers();
      setLogForm({
        date: new Date().toISOString().split('T')[0],
        type: '장기보험',
        inquiry: '',
        analysis: '',
        proposal: '',
        postPlan: '',
        files: []
      });
    } catch (err) {
      console.error(err);
      showToast('error', err.message);
    }
  };

  // Open Windows Explorer or Cloud Link
  const handleOpenFolder = async (customer) => {
    if (connectionMode === 'cloud') {
      const folderUrl = `https://drive.google.com/drive/folders/${customer.folderId}`;
      window.open(folderUrl, '_blank');
    } else {
      try {
        const res = await fetch('/api/customers/open-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: customer.category, name: customer.name })
        });
        if (!res.ok) throw new Error('폴더를 열 수 없습니다.');
        showToast('success', '고객 탐색기 폴더를 열었습니다.');
      } catch (err) {
        showToast('error', err.message);
      }
    }
  };

  // Open specific file
  const handleOpenFile = async (file) => {
    if (!selectedCustomer) return;
    
    if (connectionMode === 'cloud') {
      if (file.webViewLink) {
        window.open(file.webViewLink, '_blank');
      } else {
        showToast('error', '파일 구글 웹뷰 링크가 없습니다.');
      }
    } else {
      try {
        const res = await fetch('/api/customers/open-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: selectedCustomer.category, name: selectedCustomer.name, fileName: file.name, folder: file.folder })
        });
        if (!res.ok) throw new Error('파일을 열 수 없습니다.');
        showToast('success', `${file.name} 파일을 실행했습니다.`);
      } catch (err) {
        showToast('error', err.message);
      }
    }
  };

  // File Upload
  const handleFileUpload = async (files) => {
    if (!selectedCustomer || files.length === 0) return;

    try {
      showToast('success', '파일 업로드를 시작합니다...');
      
      if (connectionMode === 'cloud') {
        for (let i = 0; i < files.length; i++) {
          await uploadFileToCloudFolder(selectedCustomer.folderId, files[i]);
        }
        showToast('success', '구글 클라우드 업로드 완료!');
      } else {
        const formData = new FormData();
        for (let i = 0; i < files.length; i++) {
          formData.append('files', files[i]);
        }

        const res = await fetch(`/api/customers/upload?category=${encodeURIComponent(selectedCustomer.category)}&name=${encodeURIComponent(selectedCustomer.name)}`, {
          method: 'POST',
          body: formData
        });

        if (!res.ok) throw new Error('업로드 실패');
        showToast('success', '파일 업로드 성공!');
      }

      fetchCustomerDetails(selectedCustomer);
    } catch (err) {
      console.error(err);
      showToast('error', err.message);
    }
  };

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => { setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) handleFileUpload(e.dataTransfer.files);
  };

  const handleFileChange = (e) => {
    if (e.target.files) handleFileUpload(e.target.files);
  };

  const toggleFileAssociation = (fileName) => {
    setLogForm(prev => {
      const alreadyAttached = prev.files.includes(fileName);
      const updatedFiles = alreadyAttached
        ? prev.files.filter(f => f !== fileName)
        : [...prev.files, fileName];
      return { ...prev, files: updatedFiles };
    });
  };

  const triggerFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // Save Settings
  const handleSaveSettings = (e) => {
    e.preventDefault();
    localStorage.setItem('insurechart_client_id', clientId);
    localStorage.setItem('insurechart_api_key', apiKey);
    setShowSettings(false);
    showToast('success', 'API 키가 저장되었습니다.');
    if (connectionMode === 'cloud') setupGoogleClients();
  };

  // Switch connection mode
  const handleModeChange = (mode) => {
    setConnectionMode(mode);
    localStorage.setItem('insurechart_mode', mode);
    setSelectedCustomer(null);
    setCustomerDetails(null);
    showToast('success', `${mode === 'cloud' ? '구글 클라우드' : '로컬 PC'} 모드 적용`);
  };

  // Save digital card builder data
  const handleSaveCardData = (e) => {
    e.preventDefault();
    localStorage.setItem('insurechart_card', JSON.stringify(cardData));
    showToast('success', '디지털 명함 정보가 성공적으로 저장되었습니다!');
  };

  // Copy business card URL link (Base64 encryption)
  const handleCopyCardLink = () => {
    try {
      const base64 = btoa(encodeURIComponent(JSON.stringify(cardData)));
      const shareUrl = `${window.location.origin}${window.location.pathname}?card=${base64}`;
      
      navigator.clipboard.writeText(shareUrl);
      showToast('success', '디지털 명함 인터넷 주소를 클립보드에 복사했습니다!');
    } catch (e) {
      showToast('error', '주소 복사 실패');
    }
  };

  // Filters & Search
  const filteredCustomers = customers.filter(c => {
    const nameMatch = c.name.toLowerCase().includes(searchQuery.toLowerCase());
    if (selectedCategory === 'ALL') return nameMatch;
    return c.category === selectedCategory && nameMatch;
  });

  const totalClients = customers.length;
  const clientsWithLogs = customers.filter(c => c.hasLogs).length;

  const getFileIcon = (ext) => {
    const cleanExt = ext.replace('.', '').toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'bmp'].includes(cleanExt)) {
      return <FileImage className="file-icon-wrapper" size={16} />;
    }
    if (['xls', 'xlsx', 'csv'].includes(cleanExt)) {
      return <FileSpreadsheet className="file-icon-wrapper" size={16} />;
    }
    return <File className="file-icon-wrapper" size={16} />;
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // RENDER: Shared Business Card view in full screen (Mobile optimized)
  if (sharedCardData) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100vh', width: '100vw', padding: '20px',
        background: 'linear-gradient(135deg, hsl(220, 25%, 10%), hsl(220, 30%, 18%))', color: 'white'
      }}>
        <div className="digital-card-perspective flipped" style={{ width: '340px', height: '200px' }}>
          <div className="digital-card-inner">
            {/* Front */}
            <div className="digital-card-front">
              <div className="card-header-logo">
                <span className="card-logo">
                  <FolderOpen size={16} /> InsureChart
                  <span className="card-logo-dot"></span>
                </span>
                <span className="card-title-badge">{sharedCardData.company || '보험설계'}</span>
              </div>
              <div className="card-user-info">
                <div className="card-name-area">
                  <div className="card-name">{sharedCardData.name || '설계사명'}</div>
                  <div className="card-position">{sharedCardData.title || '재무설계전문가'}</div>
                </div>
              </div>
              <div className="card-footer">
                <div>📞 {sharedCardData.phone || '연락처 미기재'}</div>
                <div>✉️ {sharedCardData.email || '이메일 미기재'}</div>
              </div>
            </div>
            
            {/* Back */}
            <div className="digital-card-back">
              <div>
                <div className="card-back-title">전문 상담 분야</div>
                <div className="card-specialties">
                  {(sharedCardData.specialty || '').split(',').map(s => (
                    <span key={s} className="card-spec-tag">{s.trim()}</span>
                  ))}
                </div>
              </div>
              <div className="card-motto">
                "{sharedCardData.motto}"
              </div>
              {sharedCardData.kakaoLink && (
                <a href={sharedCardData.kakaoLink} target="_blank" rel="noopener noreferrer" className="card-qr-btn">
                  💬 카카오톡 오픈채팅 상담하기
                </a>
              )}
            </div>
          </div>
        </div>

        <p style={{ color: 'hsl(var(--text-muted))', fontSize: '11px', textAlign: 'center', maxWidth: '300px', lineHeight: '1.4', marginBottom: '20px' }}>
          위 명함 카드를 터치/클릭하면 앞뒷면을 뒤집어볼 수 있습니다.
        </p>

        <button 
          onClick={() => {
            const url = new URL(window.location.href);
            url.searchParams.delete('card');
            window.history.pushState({}, '', url.toString());
            setSharedCardData(null);
          }}
          className="btn btn-secondary"
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <ArrowLeft size={14} />
          InsureChart 홈으로 이동
        </button>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand">
            <span className="brand-icon">
              <FolderOpen size={24} strokeWidth={2.5} />
            </span>
            <h1 style={{ cursor: 'pointer' }} onClick={() => setSelectedCustomer(null)}>InsureChart</h1>
            <span className="client-count">{customers.length}</span>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <div className="search-box" style={{ flex: 1, marginBottom: 0 }}>
              <Search className="search-icon" size={16} />
              <input 
                type="text" 
                placeholder="고객 이름 검색..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />
            </div>
            <button 
              onClick={() => setShowRegisterModal(true)}
              className="btn btn-accent"
              style={{ padding: '8px 12px' }}
              title="새로운 신규 고객 폴더 및 카드를 자동 생성합니다."
            >
              <Plus size={16} />
            </button>
          </div>

          <div className="category-tabs">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`category-tab ${selectedCategory === cat ? 'active' : ''}`}
              >
                {cat === 'ALL' ? '전체' : cat}
              </button>
            ))}
          </div>
        </div>

        {/* Customer List */}
        <div className="customer-list-container">
          {isLoading ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'hsl(var(--text-muted))' }}>
              <RefreshCw className="animate-spin" style={{ margin: '0 auto 10px' }} size={24} />
              <span>동기화 진행 중...</span>
            </div>
          ) : filteredCustomers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'hsl(var(--text-muted))', fontSize: '13px' }}>
              검색 조건에 맞는 고객이 없습니다.
            </div>
          ) : (
            filteredCustomers.map(c => (
              <div 
                key={`${c.category}-${c.name}`}
                onClick={() => fetchCustomerDetails(c)}
                className={`customer-item ${selectedCustomer && selectedCustomer.name === c.name && selectedCustomer.category === c.category ? 'active' : ''}`}
              >
                <div className="customer-info">
                  <span className="customer-name">{c.name}</span>
                  <span className="customer-path-desc">{c.category} · {c.name} 폴더</span>
                </div>
                <div className="customer-badges">
                  {c.hasLogs && <span className="badge-log" title="상담 기록 있음"></span>}
                  <span className="badge-cat">{c.category}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        <header className="main-header">
          <div className="header-title-area">
            {selectedCustomer ? (
              <>
                <FolderOpen size={20} className="brand-icon" />
                <span className="header-title">{selectedCustomer.category} &gt; {selectedCustomer.name} 차트</span>
              </>
            ) : (
              <>
                {/* Workspace Navigation Tabs (Left header) */}
                <div className="workspace-tabs">
                  <button 
                    onClick={() => setActiveTab('chart')}
                    className={`workspace-tab ${activeTab === 'chart' ? 'active' : ''}`}
                  >
                    <BarChart2 size={14} />
                    대시보드
                  </button>
                  <button 
                    onClick={() => setActiveTab('map')}
                    className={`workspace-tab ${activeTab === 'map' ? 'active' : ''}`}
                  >
                    <Map size={14} />
                    고객 위치 지도
                  </button>
                  <button 
                    onClick={() => setActiveTab('card')}
                    className={`workspace-tab ${activeTab === 'card' ? 'active' : ''}`}
                  >
                    <Contact size={14} />
                    디지털 명함
                  </button>
                </div>
              </>
            )}
          </div>
          
          <div className="header-actions">
            {/* Mode Switcher */}
            <div style={{ display: 'flex', border: '1px solid hsl(var(--border))', borderRadius: '8px', padding: '2px', backgroundColor: 'hsl(var(--bg-main) / 0.5)', marginRight: '6px' }}>
              <button 
                onClick={() => handleModeChange('local')}
                className={`btn ${connectionMode === 'local' ? 'btn-primary' : ''}`}
                style={{ padding: '6px 12px', fontSize: '11px', borderRadius: '6px', border: 'none', display: 'flex', alignItems: 'center', gap: '4px', background: connectionMode === 'local' ? '' : 'transparent', color: connectionMode === 'local' ? '' : 'hsl(var(--text-muted))' }}
              >
                <Laptop size={12} />
                로컬 PC
              </button>
              <button 
                onClick={() => handleModeChange('cloud')}
                className={`btn ${connectionMode === 'cloud' ? 'btn-primary' : ''}`}
                style={{ padding: '6px 12px', fontSize: '11px', borderRadius: '6px', border: 'none', display: 'flex', alignItems: 'center', gap: '4px', background: connectionMode === 'cloud' ? '' : 'transparent', color: connectionMode === 'cloud' ? '' : 'hsl(var(--text-muted))' }}
              >
                <Globe size={12} />
                구글 클라우드
              </button>
            </div>

            {connectionMode === 'cloud' && !isCloudConnected && (
              <button onClick={handleGoogleLogin} className="btn btn-accent animate-pulse" style={{ padding: '8px 12px', fontSize: '12px' }}>
                <LogIn size={13} /> 구글 연동
              </button>
            )}

            <button onClick={() => setShowSettings(true)} className="btn btn-secondary" title="구글 API 연동 설정" style={{ padding: '8px' }}><Settings size={16} /></button>

            {selectedCustomer && (
              <>
                <button 
                  onClick={() => handleOpenFolder(selectedCustomer)}
                  className="btn btn-secondary"
                  title={connectionMode === 'cloud' ? "구글 웹드라이브 폴더 열기" : "탐색기 폴더 열기"}
                >
                  <ExternalLink size={14} />
                  {connectionMode === 'cloud' ? '웹 드라이브' : 'PC 폴더 열기'}
                </button>
                <button onClick={() => setSelectedCustomer(null)} className="btn btn-primary">대시보드</button>
              </>
            )}
            
            <button onClick={fetchCustomers} className="btn btn-secondary" title="새로고침" style={{ padding: '8px 12px' }}><RefreshCw size={14} /></button>
          </div>
        </header>

        <div className="content-body">
          {error && (
            <div className="section-card animate-fade-in" style={{ borderColor: 'red', backgroundColor: 'rgba(255,0,0,0.05)', marginBottom: '24px' }}>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', color: '#e74c3c' }}>
                <ShieldAlert size={24} />
                <div style={{ flex: 1 }}><h4 style={{ fontWeight: 700 }}>연동 상태 확인 필요</h4><p style={{ fontSize: '13px' }}>{error}</p></div>
              </div>
            </div>
          )}

          {/* Details View */}
          {selectedCustomer ? (
            isDetailsLoading ? (
              <div style={{ textAlign: 'center', padding: '100px 0', color: 'hsl(var(--text-muted))' }}>
                <RefreshCw className="animate-spin" style={{ margin: '0 auto 16px' }} size={32} />
                <p>고객의 상세 일지와 파일을 수집하는 중...</p>
              </div>
            ) : (
              <div className="details-grid animate-fade-in">
                {/* Left Column: Profile Card, ISAP Editor & Timeline */}
                <div className="details-main-column">
                  
                  {/* Customer Profile Meta Panel */}
                  {customerDetails && (
                    <div className="profile-meta-panel">
                      <div className="profile-meta-item">
                        <span className="profile-meta-label">📍 고객 거주 주소</span>
                        <span className="profile-meta-value" title={customerDetails.profile.address}>
                          <MapPin size={13} style={{ color: 'hsl(var(--accent))' }} />
                          {customerDetails.profile.address || '주소 미입력'}
                        </span>
                      </div>
                      <div className="profile-meta-item">
                        <span className="profile-meta-label">🎂 고객 생년월일</span>
                        <span className="profile-meta-value">
                          <Calendar size={13} style={{ color: 'hsl(var(--accent))' }} />
                          {customerDetails.profile.birthday || '미입력'}
                          {customerDetails.profile.birthday && connectionMode === 'cloud' && (
                            <button onClick={handleSyncBirthdayToCalendar} className="btn-icon" style={{ padding: '2px' }} title="구글 캘린더에 연간 자동 생일 알림 일정으로 추가"><Plus size={12} /></button>
                          )}
                        </span>
                      </div>
                      <div className="profile-meta-item">
                        <span className="profile-meta-label">📜 주요 보험 계약일</span>
                        <span className="profile-meta-value">
                          <FileText size={13} style={{ color: 'hsl(var(--accent))' }} />
                          {customerDetails.profile.contractDate || '미입력'}
                          {customerDetails.profile.contractDate && connectionMode === 'cloud' && (
                            <button onClick={handleSyncContractToCalendar} className="btn-icon" style={{ padding: '2px' }} title="구글 캘린더에 연간 계약일 일정으로 추가"><Plus size={12} /></button>
                          )}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                        <button onClick={handleOpenEditProfile} className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '11px', gap: '4px' }}>
                          <Edit2 size={11} /> 프로필 수정
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ISAP Log Creator */}
                  <div className="section-card">
                    <div className="section-header">
                      <h3 className="section-title"><Plus size={16} />신규 보험 상담 일지 작성</h3>
                      <span className="badge-cat" style={{ backgroundColor: 'hsl(var(--accent) / 0.1)', color: 'hsl(var(--accent))' }}>ISAP 진료차트 스타일</span>
                    </div>

                    <form onSubmit={handleSaveLog}>
                      <div className="form-grid">
                        <div>
                          <label className="form-label"><Calendar size={13} />상담 일시</label>
                          <input type="date" value={logForm.date} onChange={(e) => setLogForm(prev => ({ ...prev, date: e.target.value }))} className="form-input" required />
                        </div>
                        <div>
                          <label className="form-label"><Clock size={13} />상담 유형</label>
                          <select value={logForm.type} onChange={(e) => setLogForm(prev => ({ ...prev, type: e.target.value }))} className="form-input">
                            <option value="장기보험">장기보험</option>
                            <option value="자동차보험">자동차보험</option>
                            <option value="보상청구">보상청구</option>
                            <option value="일반재무상담">일반재무상담</option>
                            <option value="기타">기타</option>
                          </select>
                        </div>

                        <div className="form-group-full">
                          <label className="form-label"><span className="form-label-letter">I</span>Inquiry (고객 니즈 및 방문 상황)</label>
                          <textarea placeholder="고객의 가입 동기, 기존 불만 사항, 가족력 등 주관적인 니즈를 기록하세요." value={logForm.inquiry} onChange={(e) => setLogForm(prev => ({ ...prev, inquiry: e.target.value }))} className="form-input" rows={3} />
                        </div>

                        <div className="form-group-full">
                          <label className="form-label"><span className="form-label-letter">A</span>Analysis (기존 보유 보험 분석 결과)</label>
                          <textarea placeholder="기존 가입한 담보 현황, 보험료 총액 대비 암/뇌/심 진단비 한도 평가 등 객관적 분석을 기록하세요." value={logForm.analysis} onChange={(e) => setLogForm(prev => ({ ...prev, analysis: e.target.value }))} className="form-input" rows={3} />
                        </div>

                        <div className="form-group-full">
                          <label className="form-label"><span className="form-label-letter accent">P</span>Proposal (맞춤 설계 및 신규 제안안)</label>
                          <textarea placeholder="분석을 통해 도출된 보장 공백 보완용 맞춤 담보 설계 및 추천 상품군을 기록하세요." value={logForm.proposal} onChange={(e) => setLogForm(prev => ({ ...prev, proposal: e.target.value }))} className="form-input" rows={3} />
                        </div>

                        <div className="form-group-full">
                          <label className="form-label"><span className="form-label-letter accent">P</span>Post-Plan (사후 일정 및 향후 계획)</label>
                          <textarea placeholder="가입 설계안 전달 예정일, 2차 상담 시간 피드백, 계약 체결 목표 및 관리 계획을 적으세요." value={logForm.postPlan} onChange={(e) => setLogForm(prev => ({ ...prev, postPlan: e.target.value }))} className="form-input" rows={2} />
                        </div>
                      </div>

                      {customerDetails && customerDetails.files.length > 0 && (
                        <div style={{ marginBottom: '16px' }}>
                          <label className="form-label" style={{ fontSize: '11px', color: 'hsl(var(--text-muted))' }}>이번 상담과 관련된 파일 연결:</label>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '6px' }}>
                            {customerDetails.files.map(f => (
                              <button
                                type="button" key={f.name} onClick={() => toggleFileAssociation(f.name)}
                                className={`attached-file-tag ${logForm.files.includes(f.name) ? 'active' : ''}`}
                                style={{
                                  cursor: 'pointer',
                                  borderColor: logForm.files.includes(f.name) ? 'hsl(var(--accent))' : 'hsl(var(--border))',
                                  backgroundColor: logForm.files.includes(f.name) ? 'hsl(var(--accent) / 0.08)' : 'transparent',
                                  color: logForm.files.includes(f.name) ? 'hsl(var(--accent))' : 'hsl(var(--text-main))'
                                }}
                              >
                                {logForm.files.includes(f.name) && <Check size={10} />} {f.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="form-actions">
                        <button type="submit" className="btn btn-accent"><Plus size={14} />차트에 상담 기록 추가</button>
                      </div>
                    </form>
                  </div>

                  {/* Timeline History */}
                  <div className="section-card">
                    <div className="section-header">
                      <h3 className="section-title"><Clock size={16} />누적 상담 히스토리 ({customerDetails?.logs?.length || 0}건)</h3>
                    </div>

                    {customerDetails?.logs?.length === 0 ? (
                      <div className="empty-timeline">
                        <Info className="empty-timeline-icon" size={24} />
                        <p>아직 작성된 상담 일지가 없습니다.</p>
                      </div>
                    ) : (
                      <div className="timeline-container">
                        {[...customerDetails.logs].reverse().map((entry, idx) => (
                          <div key={entry.id || idx} className="timeline-item animate-fade-in">
                            <div className="timeline-dot"></div>
                            <div className="timeline-card">
                              <div className="timeline-card-header">
                                <div className="timeline-date-badge"><Calendar size={12} />{entry.date}</div>
                                <span className="timeline-type-badge">{entry.type}</span>
                              </div>
                              <div className="timeline-content-grid">
                                {entry.inquiry && <div className="timeline-section"><span className="timeline-section-label">I (고객 상황)</span><div className="timeline-section-value">{entry.inquiry}</div></div>}
                                {entry.analysis && <div className="timeline-section"><span className="timeline-section-label">A (보장 분석)</span><div className="timeline-section-value">{entry.analysis}</div></div>}
                                {entry.proposal && <div className="timeline-section"><span className="timeline-section-label">P (맞춤 제안)</span><div className="timeline-section-value">{entry.proposal}</div></div>}
                                {entry.postPlan && <div className="timeline-section"><span className="timeline-section-label">P (향후 계획)</span><div className="timeline-section-value">{entry.postPlan}</div></div>}
                              </div>
                              {entry.files && entry.files.length > 0 && (
                                <div className="timeline-attached-files">
                                  <span className="timeline-section-label" style={{ display: 'block', width: '100%', marginBottom: '4px' }}>연관 파일</span>
                                  {entry.files.map(fName => <span key={fName} className="attached-file-tag"><File size={10} />{fName}</span>)}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column: Files Manager */}
                <div className="details-side-column">
                  <div className="section-card">
                    <div className="section-header">
                      <h3 className="section-title"><Folder size={16} />첨부 문서 보관함 ({customerDetails?.files?.length || 0})</h3>
                    </div>
                    <div className="file-list">
                      {customerDetails?.files?.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '30px 10px', color: 'hsl(var(--text-muted))', fontSize: '12px' }}>보관함이 비어있습니다.</div>
                      ) : (
                        (() => {
                          const groupedFiles = {};
                          customerDetails.files.forEach(file => {
                            const folderName = file.folder || '';
                            if (!groupedFiles[folderName]) {
                              groupedFiles[folderName] = [];
                            }
                            groupedFiles[folderName].push(file);
                          });

                          return Object.entries(groupedFiles).map(([folderName, folderFiles]) => {
                            if (folderName === '') {
                              return folderFiles.map(file => (
                                <div key={file.name || file.id} className="file-item animate-fade-in" style={{ marginBottom: '6px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', flex: 1 }}>
                                    {getFileIcon(file.ext)}
                                    <div className="file-info">
                                      <span className="file-name" title={file.name}>{file.name}</span>
                                      <span className="file-meta">{formatBytes(file.size)} · {new Date(file.modified).toLocaleDateString()}</span>
                                    </div>
                                  </div>
                                  <div className="file-actions">
                                    <button onClick={() => handleOpenFile(file)} className="btn-icon" title="파일 열기"><ExternalLink size={14} /></button>
                                  </div>
                                </div>
                              ));
                            }

                            const isCollapsed = collapsedFolders[folderName] ?? true;
                            return (
                              <div key={folderName} className="folder-group" style={{ marginBottom: '8px' }}>
                                <div 
                                  onClick={() => setCollapsedFolders(prev => ({ ...prev, [folderName]: !isCollapsed }))}
                                  style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    padding: '8px 12px', cursor: 'pointer', backgroundColor: 'hsl(var(--bg-main) / 0.7)',
                                    borderRadius: 'var(--radius-sm)', border: '1px solid hsl(var(--border))',
                                    fontSize: '12px', fontWeight: 'bold', color: 'hsl(var(--primary))'
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <Folder size={14} style={{ color: 'hsl(var(--accent))' }} />
                                    <span>{folderName}</span>
                                    <span style={{ fontSize: '10px', color: 'hsl(var(--text-muted))', fontWeight: 'normal' }}>({folderFiles.length})</span>
                                  </div>
                                  <ChevronRight size={14} style={{ transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 0.2s' }} />
                                </div>
                                
                                {!isCollapsed && (
                                  <div style={{ paddingLeft: '8px', marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {folderFiles.map(file => (
                                      <div key={file.name || file.id} className="file-item animate-fade-in" style={{ padding: '8px 10px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', flex: 1 }}>
                                          {getFileIcon(file.ext)}
                                          <div className="file-info" style={{ margin: '0 8px' }}>
                                            <span className="file-name" title={file.name} style={{ fontSize: '11.5px' }}>{file.name}</span>
                                            <span className="file-meta" style={{ fontSize: '9px' }}>{formatBytes(file.size)}</span>
                                          </div>
                                        </div>
                                        <div className="file-actions">
                                          <button onClick={() => handleOpenFile(file)} className="btn-icon" title="파일 열기" style={{ padding: '4px' }}><ExternalLink size={12} /></button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          });
                        })()
                      )}
                    </div>
                    <div className={`drag-drop-zone ${isDragging ? 'active' : ''}`} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} onClick={triggerFileInput}>
                      <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} multiple />
                      <Upload className="drag-drop-icon" size={24} />
                      <span className="drag-drop-text">여기에 파일을 끌어다 놓거나 클릭</span>
                    </div>
                  </div>
                </div>
              </div>
            )
          ) : (
            /* Dashboard, Map or Card Tabs (Selected Customer is null) */
            <>
              {activeTab === 'chart' && (
                <div className="dashboard-view animate-fade-in">
                  <div className="welcome-banner">
                    <h2>보험 고객 상담 차트 시스템</h2>
                    <p>
                      고객들의 보험 보장 현황 분석과 상담 이력을 체계적으로 기록하고 관리하는 설계사 맞춤형 솔루션입니다. 
                      동작 모드에 따라 로컬 PC 자원을 활용하거나 폰/노트북으로 구글 드라이브 클라우드에 직접 안전하게 백업합니다.
                    </p>
                  </div>

                  <div className="stats-grid">
                    <div className="stat-card">
                      <div className="stat-icon"><User size={20} /></div>
                      <div className="stat-info"><span className="stat-label">전체 고객 수</span><span className="stat-value">{totalClients}명</span></div>
                    </div>
                    <div className="stat-card accent">
                      <div className="stat-icon"><FileText size={20} /></div>
                      <div className="stat-info"><span className="stat-label">일지 작성된 고객</span><span className="stat-value">{clientsWithLogs}명</span></div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-icon"><FolderOpen size={20} /></div>
                      <div className="stat-info"><span className="stat-label">연동 동기화 모드</span><span className="stat-value">{connectionMode === 'cloud' ? '구글 클라우드' : '로컬 PC 모드'}</span></div>
                    </div>
                  </div>

                  <div className="info-box">
                    <h3><BookOpen size={16} />ISAP 진료차트 기록 방법 안내</h3>
                    <div className="isap-steps">
                      <div className="isap-step">
                        <div className="isap-letter">I</div>
                        <div className="isap-title">Inquiry (고객 니즈)</div>
                        <div className="isap-desc">고객이 먼저 문의한 내용, 상담 유입 경로, 건강 상태(기왕력 등), 보험 예산을 파악해 기록합니다.</div>
                      </div>
                      <div className="isap-step">
                        <div className="isap-letter">A</div>
                        <div className="isap-title">Analysis (보장 분석)</div>
                        <div className="isap-desc">기존에 가입되어 있는 보장 담보 분석, 과다하거나 누락된 항목 등 객관적인 보장 진단 내용을 입력합니다.</div>
                      </div>
                      <div className="isap-step accent">
                        <div className="isap-letter">P</div>
                        <div className="isap-title">Proposal (맞춤 제안)</div>
                        <div className="isap-desc">부족한 담보를 메우기 위해 새로 설계한 신규 가입 제안서 내역과 보험회사 추천 정보를 작성합니다.</div>
                      </div>
                      <div className="isap-step accent">
                        <div className="isap-letter">P</div>
                        <div className="isap-title">Post-Plan (향후 계획)</div>
                        <div className="isap-desc">설계서 발송 예정일, 추가 피드백 일정, 계약 서명 등 2차 상담 계획 및 목표 체결일을 기록합니다.</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'map' && (
                <div className="animate-fade-in">
                  <MapComponent 
                    customers={customers} 
                    apiKey={apiKey} 
                    onSelectCustomer={handleSelectCustomerFromMap} 
                  />
                </div>
              )}

              {activeTab === 'card' && (
                <div className="card-container animate-fade-in">
                  {/* Business Card Edit Form */}
                  <div className="section-card card-form-scroll">
                    <div className="section-header">
                      <h3 className="section-title"><Contact size={16} />디지털 명함 정보 관리</h3>
                    </div>
                    <form onSubmit={handleSaveCardData}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div>
                          <label className="form-label">이름</label>
                          <input type="text" value={cardData.name} onChange={(e) => setCardData(prev => ({ ...prev, name: e.target.value }))} className="form-input" placeholder="홍길동" required />
                        </div>
                        <div>
                          <label className="form-label">직급 및 타이틀</label>
                          <input type="text" value={cardData.title} onChange={(e) => setCardData(prev => ({ ...prev, title: e.target.value }))} className="form-input" placeholder="보험금융 대리점 FC / 재무설계사" />
                        </div>
                        <div>
                          <label className="form-label">소속 회사</label>
                          <input type="text" value={cardData.company} onChange={(e) => setCardData(prev => ({ ...prev, company: e.target.value }))} className="form-input" placeholder="광북금융솔루션" />
                        </div>
                        <div>
                          <label className="form-label">연락처</label>
                          <input type="text" value={cardData.phone} onChange={(e) => setCardData(prev => ({ ...prev, phone: e.target.value }))} className="form-input" placeholder="010-1234-5678" />
                        </div>
                        <div>
                          <label className="form-label">이메일</label>
                          <input type="email" value={cardData.email} onChange={(e) => setCardData(prev => ({ ...prev, email: e.target.value }))} className="form-input" placeholder="gwangbuk@insure.com" />
                        </div>
                        <div>
                          <label className="form-label">카카오 오픈채팅 주소</label>
                          <input type="url" value={cardData.kakaoLink} onChange={(e) => setCardData(prev => ({ ...prev, kakaoLink: e.target.value }))} className="form-input" placeholder="https://open.kakao.com/o/..." />
                        </div>
                        <div>
                          <label className="form-label">주요 상담 분야</label>
                          <input type="text" value={cardData.specialty} onChange={(e) => setCardData(prev => ({ ...prev, specialty: e.target.value }))} className="form-input" placeholder="보장분석, 실손의료비, 암/종합보험 설계 (쉼표로 구분)" />
                        </div>
                        <div>
                          <label className="form-label">좌우명 / 슬로건</label>
                          <input type="text" value={cardData.motto} onChange={(e) => setCardData(prev => ({ ...prev, motto: e.target.value }))} className="form-input" placeholder="고객의 자산을 내 자산처럼 성실히 관리합니다." />
                        </div>
                        
                        <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                          <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>정보 저장하기</button>
                          <button type="button" onClick={handleCopyCardLink} className="btn btn-accent" style={{ flex: 1 }}>명함 링크 복사</button>
                        </div>
                      </div>
                    </form>
                  </div>

                  {/* Business Card Interactive Preview */}
                  <div className="card-preview-area">
                    <div className="section-title" style={{ position: 'absolute', top: '16px', left: '16px' }}>
                      <Contact size={14} /> 디지털 명함 실시간 미리보기
                    </div>
                    
                    <div className={`digital-card-perspective ${cardFlipped ? 'flipped' : ''}`} onClick={() => setCardFlipped(!cardFlipped)}>
                      <div className="digital-card-inner">
                        {/* Front */}
                        <div className="digital-card-front">
                          <div className="card-header-logo">
                            <span className="card-logo">
                              <FolderOpen size={16} /> InsureChart
                              <span className="card-logo-dot"></span>
                            </span>
                            <span className="card-title-badge">{cardData.company || '광북금융'}</span>
                          </div>
                          <div className="card-user-info">
                            <div>
                              <div className="card-name">{cardData.name || '홍길동'}</div>
                              <div className="card-position">{cardData.title || '재무설계전문가'}</div>
                            </div>
                          </div>
                          <div className="card-footer">
                            <div>📞 {cardData.phone || '010-0000-0000'}</div>
                            <div>✉️ {cardData.email || 'info@domain.com'}</div>
                          </div>
                        </div>
                        
                        {/* Back */}
                        <div className="digital-card-back">
                          <div>
                            <div className="card-back-title">전문 분야</div>
                            <div className="card-specialties">
                              {cardData.specialty.split(',').map((s, i) => (
                                <span key={i} className="card-spec-tag">{s.trim()}</span>
                              ))}
                            </div>
                          </div>
                          <div className="card-motto">
                            "{cardData.motto}"
                          </div>
                          {cardData.kakaoLink && (
                            <a href={cardData.kakaoLink} target="_blank" rel="noopener noreferrer" className="card-qr-btn">
                              💬 카카오톡 오픈채팅 상담하기
                            </a>
                          )}
                        </div>
                      </div>
                    </div>

                    <p style={{ color: 'hsl(var(--text-muted))', fontSize: '11.5px', textAlign: 'center', maxWidth: '300px', lineHeight: '1.4' }}>
                      위 명함을 터치/클릭하면 앞뒤로 뒤집어볼 수 있습니다. 
                      <strong>[명함 링크 복사]</strong> 버튼을 누르면 고객에게 카카오톡이나 문자로 보낼 수 있는 고유 명함 사이트 주소가 클립보드에 복사됩니다.
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* MODAL: Google Drive Settings */}
      {showSettings && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="section-header">
              <h3 className="section-title"><Settings size={16} />구글 클라우드 연동 환경 설정</h3>
            </div>
            <form onSubmit={handleSaveSettings}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
                <div>
                  <label className="form-label" style={{ fontWeight: '600' }}>구글 OAuth Client ID</label>
                  <input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="xxxxxxxx.apps.googleusercontent.com" className="form-input" required />
                </div>
                <div>
                  <label className="form-label" style={{ fontWeight: '600' }}>구글 API Key</label>
                  <input type="text" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="AIzaSyXXXXXXXXXXXXXXXXXX" className="form-input" required />
                </div>
                <div style={{ border: '1px solid hsl(var(--border))', borderRadius: '6px', padding: '8px 12px', fontSize: '11px', color: 'hsl(var(--text-muted))', backgroundColor: 'hsl(var(--bg-main) / 0.3)', lineHeight: '1.4' }}>
                  <strong>💡 구글 API 세팅 가이드:</strong><br />
                  1. GCP(console.cloud.google.com) 로그인 및 프로젝트 생성.<br />
                  2. <strong>Google Drive API / Geocoding API / Maps JavaScript API / Google Calendar API</strong> 활성화.<br />
                  3. OAuth 동의 화면에서 <strong>.../auth/drive.file</strong> 및 <strong>.../auth/calendar.events</strong> 범위 권한을 추가해 주세요.<br />
                  4. 사용자 인증 정보 탭에서 [API 키] 및 [OAuth 클라이언트 ID] 발급.<br />
                  5. 승인된 JavaScript 원본에 <code>http://localhost:3000</code>, <code>http://localhost:5000</code> 및 본인의 웹 서버 도메인을 반드시 등록해 주세요.
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" onClick={() => setShowSettings(false)} className="btn btn-secondary">닫기</button>
                <button type="submit" className="btn btn-accent">설정 저장 및 연동</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Customer Registration (Folder Auto-Bootstrapper) */}
      {showRegisterModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '480px' }}>
            <div className="section-header">
              <h3 className="section-title"><Plus size={16} />신규 보험 고객 등록 및 폴더 자동 생성</h3>
            </div>
            <form onSubmit={handleRegisterCustomer}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
                <div>
                  <label className="form-label">고객 이름</label>
                  <input 
                    type="text" 
                    value={registerForm.name} 
                    onChange={(e) => setRegisterForm(prev => ({ ...prev, name: e.target.value }))} 
                    placeholder="김재연" 
                    className="form-input" 
                    required 
                  />
                </div>
                
                <div>
                  <label className="form-label">분류 지정 (자음별 자동 매칭 적용)</label>
                  <select 
                    value={registerForm.category}
                    onChange={(e) => setRegisterForm(prev => ({ ...prev, category: e.target.value }))}
                    className="form-input"
                  >
                    <option value="ㄱ">ㄱ (김, 강, 구 등)</option>
                    <option value="ㄴ~ㅅ">ㄴ~ㅅ (박, 서, 민 등)</option>
                    <option value="ㅇ">ㅇ (이, 윤, 유 등)</option>
                    <option value="ㅈ~ㅎ">ㅈ~ㅎ (정, 최, 홍 등)</option>
                    <option value="#기업">#기업 (법인 고객)</option>
                    <option value="#소개고객">#소개고객</option>
                    <option value="99_계약종료_고객">99_계약종료_고객</option>
                  </select>
                </div>

                <div>
                  <label className="form-label">📍 거주 주소 (지도 연동용)</label>
                  <input 
                    type="text" 
                    value={registerForm.address} 
                    onChange={(e) => setRegisterForm(prev => ({ ...prev, address: e.target.value }))} 
                    placeholder="서울특별시 강남구 테헤란로 123" 
                    className="form-input" 
                  />
                </div>

                <div>
                  <label className="form-label">🎂 고객 생년월일</label>
                  <input 
                    type="date" 
                    value={registerForm.birthday} 
                    onChange={(e) => setRegisterForm(prev => ({ ...prev, birthday: e.target.value }))} 
                    className="form-input" 
                  />
                  {registerForm.birthday && connectionMode === 'cloud' && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', marginTop: '4px', cursor: 'pointer', color: 'hsl(var(--accent))' }}>
                      <input 
                        type="checkbox" 
                        checked={registerForm.syncCalendarBirthday} 
                        onChange={(e) => setRegisterForm(prev => ({ ...prev, syncCalendarBirthday: e.target.checked }))} 
                      />
                      구글 캘린더에 고객 생일 자동 추가 (연간 매년 알림)
                    </label>
                  )}
                </div>

                <div>
                  <label className="form-label">📜 주요 보험 계약일</label>
                  <input 
                    type="date" 
                    value={registerForm.contractDate} 
                    onChange={(e) => setRegisterForm(prev => ({ ...prev, contractDate: e.target.value }))} 
                    className="form-input" 
                  />
                  {registerForm.contractDate && connectionMode === 'cloud' && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', marginTop: '4px', cursor: 'pointer', color: 'hsl(var(--accent))' }}>
                      <input 
                        type="checkbox" 
                        checked={registerForm.syncCalendarContract} 
                        onChange={(e) => setRegisterForm(prev => ({ ...prev, syncCalendarContract: e.target.checked }))} 
                      />
                      구글 캘린더에 보험 계약일 자동 추가 (연간 매년 알림)
                    </label>
                  )}
                </div>
              </div>
              
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" onClick={() => setShowRegisterModal(false)} className="btn btn-secondary">취소</button>
                <button type="submit" className="btn btn-accent">고객 생성 및 폴더 빌드</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Customer Profile Edit */}
      {showEditProfileModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="section-header">
              <h3 className="section-title"><Edit2 size={16} />{customerDetails?.name} 고객 프로필 수정</h3>
            </div>
            <form onSubmit={handleSaveProfile}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
                <div>
                  <label className="form-label">📍 고객 거주 주소</label>
                  <input 
                    type="text" 
                    value={profileEditForm.address} 
                    onChange={(e) => setProfileEditForm(prev => ({ ...prev, address: e.target.value }))} 
                    className="form-input" 
                  />
                </div>
                <div>
                  <label className="form-label">🎂 고객 생년월일</label>
                  <input 
                    type="date" 
                    value={profileEditForm.birthday} 
                    onChange={(e) => setProfileEditForm(prev => ({ ...prev, birthday: e.target.value }))} 
                    className="form-input" 
                  />
                </div>
                <div>
                  <label className="form-label">📜 주요 보험 계약일</label>
                  <input 
                    type="date" 
                    value={profileEditForm.contractDate} 
                    onChange={(e) => setProfileEditForm(prev => ({ ...prev, contractDate: e.target.value }))} 
                    className="form-input" 
                  />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" onClick={() => setShowEditProfileModal(false)} className="btn btn-secondary">취소</button>
                <button type="submit" className="btn btn-accent">수정사항 저장</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className={`toast ${toast.type}`}>
          <span className="toast-icon">
            {toast.type === 'success' ? <CheckCircle2 size={16} /> : <ShieldAlert size={16} />}
          </span>
          <span className="toast-text">{toast.text}</span>
        </div>
      )}
    </div>
  );
}

export default App;
