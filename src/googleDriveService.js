// Google Drive Client-side API Service
// Handles connection to Google Drive Cloud using Google Identity Services (GIS)

let tokenClient = null;
let accessToken = null;

// Load the Google API Client library and GIS SDK
export function loadGoogleApiScripts() {
  return new Promise((resolve) => {
    const checkLibs = () => {
      if (window.gapi && window.google) {
        resolve();
      } else {
        setTimeout(checkLibs, 100);
      }
    };
    checkLibs();
  });
}

// Initialize GAPI and GIS
export function initGoogleClients(clientId, apiKey, onTokenReceived) {
  return new Promise((resolve, reject) => {
    try {
      window.gapi.load('client', async () => {
        try {
          await window.gapi.client.init({
            apiKey: apiKey,
            discoveryDocs: [
              'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
              'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'
            ],
          });

          // Initialize GIS Token Client
          tokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/calendar',
            callback: (tokenResponse) => {
              if (tokenResponse.error !== undefined) {
                reject(tokenResponse);
              }
              accessToken = tokenResponse.access_token;
              if (onTokenReceived) onTokenReceived(accessToken);
              resolve(accessToken);
            },
          });

          resolve();
        } catch (err) {
          reject(err);
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

// Request Access Token
export function loginToGoogle() {
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      return reject(new Error('Google API Client가 초기화되지 않았습니다.'));
    }
    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

// Helper to check if logged in
export function isGoogleConnected() {
  return accessToken !== null;
}

// Get authorization header
function getAuthHeader() {
  return { 'Authorization': `Bearer ${accessToken}` };
}

// Find folder by name
export async function findFolderId(folderName, parentId = null) {
  let query = `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  if (parentId) {
    query += ` and '${parentId}' in parents`;
  }
  
  const response = await window.gapi.client.drive.files.list({
    q: query,
    spaces: 'drive',
    fields: 'files(id, name)',
  });
  
  const files = response.result.files;
  return files && files.length > 0 ? files[0].id : null;
}

// Create a folder
export async function createFolder(folderName, parentId = null) {
  const metadata = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder'
  };
  if (parentId) {
    metadata.parents = [parentId];
  }
  
  const response = await window.gapi.client.drive.files.create({
    resource: metadata,
    fields: 'id, name'
  });
  return response.result.id;
}

// Bootstrap Google Drive standard folders
export async function bootstrapCloudFolders() {
  try {
    // 1. Search or Create root folder
    let rootId = await findFolderId('01_장기보험_고객관리');
    if (!rootId) {
      rootId = await createFolder('01_장기보험_고객관리');
    }

    // 2. Search or Create standard categories
    const standardCats = ['ㄱ', 'ㄴ~ㅅ', 'ㅇ', 'ㅈ~ㅎ', '#기업', '#소개고객', '99_계약종료_고객'];
    const folderMap = {};

    for (const cat of standardCats) {
      let catId = await findFolderId(cat, rootId);
      if (!catId) {
        catId = await createFolder(cat, rootId);
      }
      folderMap[cat] = catId;
    }

    return { rootId, folderMap };
  } catch (error) {
    console.error('Error bootstrapping cloud folders:', error);
    throw error;
  }
}

// Scan GDrive root and list all customers
export async function scanCloudCustomers() {
  try {
    // A. Bootstrap root folder (Find or create it)
    const { folderMap } = await bootstrapCloudFolders();

    const customers = [];

    // B. Scan each category folder
    for (const [catName, catId] of Object.entries(folderMap)) {
      if (catName.startsWith('00')) continue;

      const response = await window.gapi.client.drive.files.list({
        q: `'${catId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
        pageSize: 1000
      });

      const customerFolders = response.result.files || [];
      
      // Korean initial consonant helper (초성)
      function getChoSeong(char) {
        const code = char.charCodeAt(0) - 0xAC00;
        if (code > -1 && code < 11172) {
          const choList = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
          const choIndex = Math.floor(code / 588);
          return choList[choIndex];
        }
        return char[0] || '';
      }

      for (const custFolder of customerFolders) {
        const logFileResponse = await window.gapi.client.drive.files.list({
          q: `'${custFolder.id}' in parents and name = '상담일지.json' and trashed = false`,
          fields: 'files(id)',
        });
        
        const logFiles = logFileResponse.result.files;
        const hasLogs = logFiles && logFiles.length > 0;
        const firstChar = custFolder.name[0] || '';
        const choSeong = getChoSeong(firstChar);

        customers.push({
          name: custFolder.name,
          category: catName,
          choSeong: choSeong,
          hasLogs: hasLogs,
          folderId: custFolder.id,
          categoryFolderId: catId
        });
      }
    }

    customers.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return customers;
  } catch (error) {
    console.error('Error scanning cloud customers:', error);
    throw error;
  }
}

// Create new customer inside GDrive Cloud
export async function createCloudCustomer(name, category, address = '', birthday = '', contractDate = '') {
  try {
    // 1. Bootstrap standard folders to make sure root & category exist
    const { folderMap } = await bootstrapCloudFolders();
    const categoryFolderId = folderMap[category];
    if (!categoryFolderId) {
      throw new Error(`분류 폴더 [${category}]를 찾거나 생성할 수 없습니다.`);
    }

    // 2. Check if customer folder already exists
    const existingFolderId = await findFolderId(name, categoryFolderId);
    if (existingFolderId) {
      throw new Error(`이미 해당 분류 아래에 [${name}] 고객 폴더가 존재합니다.`);
    }

    // 3. Create customer folder
    const customerFolderId = await createFolder(name, categoryFolderId);

    // 4. Create 상담일지.json
    const profile = { name, category, address, birthday, contractDate };
    const initialJsonContent = JSON.stringify({ profile, logs: [] }, null, 2);
    await createFileInFolder(customerFolderId, '상담일지.json', initialJsonContent, 'application/json');

    // 5. Create 상담일지_뷰어.txt
    let txtContent = `==================================================\n`;
    txtContent += ` [고객 보장 분석 및 상담 일지 - ${name}]\n`;
    txtContent += `==================================================\n`;
    txtContent += `- 주소: ${profile.address || '미입력'}\n`;
    txtContent += `- 생년월일: ${profile.birthday || '미입력'}\n`;
    txtContent += `- 계약일자: ${profile.contractDate || '미입력'}\n`;
    txtContent += `==================================================\n\n`;
    txtContent += `[시스템] 구글 클라우드 고객 카드가 생성되었습니다.\n`;
    await createFileInFolder(customerFolderId, '상담일지_뷰어.txt', txtContent, 'text/plain');

    return {
      name,
      category,
      folderId: customerFolderId,
      categoryFolderId
    };
  } catch (error) {
    console.error('Error creating cloud customer:', error);
    throw error;
  }
}

// Update cloud customer profile details
export async function updateCloudCustomerProfile(folderId, profileData, existingDetails) {
  try {
    const updatedProfile = {
      ...existingDetails.profile,
      address: profileData.address !== undefined ? profileData.address : existingDetails.profile.address,
      birthday: profileData.birthday !== undefined ? profileData.birthday : existingDetails.profile.birthday,
      contractDate: profileData.contractDate !== undefined ? profileData.contractDate : existingDetails.profile.contractDate
    };

    const logsContent = JSON.stringify({ profile: updatedProfile, logs: existingDetails.logs }, null, 2);

    // Update JSON file
    let jsonFileId = existingDetails.logFileId;
    if (!jsonFileId) {
      const searchJson = await window.gapi.client.drive.files.list({
        q: `'${folderId}' in parents and name = '상담일지.json' and trashed = false`,
        fields: 'files(id)'
      });
      const files = searchJson.result.files;
      jsonFileId = files && files.length > 0 ? files[0].id : null;
    }

    if (jsonFileId) {
      await updateFileContent(jsonFileId, logsContent, 'application/json');
    } else {
      await createFileInFolder(folderId, '상담일지.json', logsContent, 'application/json');
    }

    // Update TXT file
    let txtContent = `==================================================\n`;
    txtContent += ` [고객 보장 분석 및 상담 일지 - ${existingDetails.name}]\n`;
    txtContent += `==================================================\n`;
    txtContent += `- 주소: ${updatedProfile.address || '미입력'}\n`;
    txtContent += `- 생년월일: ${updatedProfile.birthday || '미입력'}\n`;
    txtContent += `- 계약일자: ${updatedProfile.contractDate || '미입력'}\n`;
    txtContent += `==================================================\n\n`;

    const sortedLogs = [...existingDetails.logs].sort((a, b) => b.date.localeCompare(a.date));
    sortedLogs.forEach((entry, idx) => {
      txtContent += `[상담 #${sortedLogs.length - idx}] ------------------------------------------\n`;
      txtContent += `- 상담 일시: ${entry.date}\n`;
      txtContent += `- 상담 유형: ${entry.type}\n\n`;
      txtContent += `1. 고객 상황 (Inquiry):\n   ${entry.inquiry.replace(/\n/g, '\n   ')}\n\n`;
      txtContent += `2. 보장 분석 (Analysis):\n   ${entry.analysis.replace(/\n/g, '\n   ')}\n\n`;
      txtContent += `3. 맞춤 제안 (Proposal):\n   ${entry.proposal.replace(/\n/g, '\n   ')}\n\n`;
      txtContent += `4. 향후 계획 (Post-Plan):\n   ${entry.postPlan.replace(/\n/g, '\n   ')}\n\n`;
      if (entry.files && entry.files.length > 0) {
        txtContent += `- 연동 첨부파일:\n   ${entry.files.join(', ')}\n`;
      }
      txtContent += `--------------------------------------------------\n\n`;
    });

    const searchTxt = await window.gapi.client.drive.files.list({
      q: `'${folderId}' in parents and name = '상담일지_뷰어.txt' and trashed = false`,
      fields: 'files(id)'
    });
    const txtFiles = searchTxt.result.files;
    const txtFileId = txtFiles && txtFiles.length > 0 ? txtFiles[0].id : null;

    if (txtFileId) {
      await updateFileContent(txtFileId, txtContent, 'text/plain');
    } else {
      await createFileInFolder(folderId, '상담일지_뷰어.txt', txtContent, 'text/plain');
    }

    return updatedProfile;
  } catch (error) {
    console.error('Error updating cloud customer profile:', error);
    throw error;
  }
}

// Get customer details (files, logs, profile metadata)
export async function getCloudCustomerDetails(folderId) {
  try {
    // Recursive GDrive scanner
    async function fetchFilesRecursive(parentId, folderPath = "") {
      const response = await window.gapi.client.drive.files.list({
        q: `'${parentId}' in parents and trashed = false`,
        fields: 'files(id, name, mimeType, size, modifiedTime, webViewLink)',
        pageSize: 1000
      });
      
      const items = response.result.files || [];
      let results = [];
      
      for (const item of items) {
        if (item.name === '상담일지.json' || item.name === '상담일지_뷰어.txt') continue;
        
        if (item.mimeType === 'application/vnd.google-apps.folder') {
          const subFolderFiles = await fetchFilesRecursive(item.id, folderPath ? `${folderPath}/${item.name}` : item.name);
          results = results.concat(subFolderFiles);
        } else {
          const ext = item.name.includes('.') ? item.name.substring(item.name.lastIndexOf('.')) : '';
          results.push({
            name: item.name,
            id: item.id,
            size: parseInt(item.size || '0'),
            modified: item.modifiedTime,
            ext: ext.toLowerCase(),
            webViewLink: item.webViewLink,
            folder: folderPath
          });
        }
      }
      return results;
    }

    const files = await fetchFilesRecursive(folderId);
    let logFileId = null;
    let logFileContent = { logs: [], profile: {} };

    // Find the logFileId in the root customer folder
    const logSearchResponse = await window.gapi.client.drive.files.list({
      q: `'${folderId}' in parents and name = '상담일지.json' and trashed = false`,
      fields: 'files(id)'
    });
    const logFiles = logSearchResponse.result.files || [];
    if (logFiles.length > 0) {
      logFileId = logFiles[0].id;
    }

    if (logFileId) {
      const logContentResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${logFileId}?alt=media`, {
        headers: getAuthHeader()
      });
      if (logContentResponse.ok) {
        try {
          const parsed = await logContentResponse.json();
          if (parsed && !Array.isArray(parsed)) {
            logFileContent = {
              logs: parsed.logs || [],
              profile: parsed.profile || {}
            };
          } else if (Array.isArray(parsed)) {
            logFileContent = {
              logs: parsed,
              profile: {}
            };
          }
        } catch (e) {
          console.error('Failed to parse cloud log file content', e);
        }
      }
    }

    return {
      files,
      logs: logFileContent.logs,
      profile: logFileContent.profile,
      logFileId
    };
  } catch (error) {
    console.error('Error getting cloud details:', error);
    throw error;
  }
}

// Save consultation log (Saves as object containing logs & profile)
export async function saveCloudLog(customerFolderId, existingLogs, newLogEntry, customerName, customerProfile = {}) {
  try {
    const logs = [...existingLogs, newLogEntry];
    const updatedProfile = { name: customerName, ...customerProfile };
    const logsContent = JSON.stringify({ profile: updatedProfile, logs }, null, 2);

    // Find JSON file ID
    const searchJson = await window.gapi.client.drive.files.list({
      q: `'${customerFolderId}' in parents and name = '상담일지.json' and trashed = false`,
      fields: 'files(id)'
    });
    const jsonFiles = searchJson.result.files;
    const jsonFileId = jsonFiles && jsonFiles.length > 0 ? jsonFiles[0].id : null;

    if (jsonFileId) {
      await updateFileContent(jsonFileId, logsContent, 'application/json');
    } else {
      await createFileInFolder(customerFolderId, '상담일지.json', logsContent, 'application/json');
    }

    // Update TXT File
    let txtContent = `==================================================\n`;
    txtContent += ` [고객 보장 분석 및 상담 일지 - ${customerName}]\n`;
    txtContent += `==================================================\n`;
    txtContent += `- 주소: ${updatedProfile.address || '미입력'}\n`;
    txtContent += `- 생년월일: ${updatedProfile.birthday || '미입력'}\n`;
    txtContent += `- 계약일자: ${updatedProfile.contractDate || '미입력'}\n`;
    txtContent += `==================================================\n\n`;

    const sortedLogs = [...logs].sort((a, b) => b.date.localeCompare(a.date));
    sortedLogs.forEach((entry, idx) => {
      txtContent += `[상담 #${sortedLogs.length - idx}] ------------------------------------------\n`;
      txtContent += `- 상담 일시: ${entry.date}\n`;
      txtContent += `- 상담 유형: ${entry.type}\n\n`;
      txtContent += `1. 고객 상황 (Inquiry):\n   ${entry.inquiry.replace(/\n/g, '\n   ')}\n\n`;
      txtContent += `2. 보장 분석 (Analysis):\n   ${entry.analysis.replace(/\n/g, '\n   ')}\n\n`;
      txtContent += `3. 맞춤 제안 (Proposal):\n   ${entry.proposal.replace(/\n/g, '\n   ')}\n\n`;
      txtContent += `4. 향후 계획 (Post-Plan):\n   ${entry.postPlan.replace(/\n/g, '\n   ')}\n\n`;
      if (entry.files && entry.files.length > 0) {
        txtContent += `- 연동 첨부파일:\n   ${entry.files.join(', ')}\n`;
      }
      txtContent += `--------------------------------------------------\n\n`;
    });

    const searchTxt = await window.gapi.client.drive.files.list({
      q: `'${customerFolderId}' in parents and name = '상담일지_뷰어.txt' and trashed = false`,
      fields: 'files(id)'
    });
    const txtFiles = searchTxt.result.files;
    const txtFileId = txtFiles && txtFiles.length > 0 ? txtFiles[0].id : null;

    if (txtFileId) {
      await updateFileContent(txtFileId, txtContent, 'text/plain');
    } else {
      await createFileInFolder(customerFolderId, '상담일지_뷰어.txt', txtContent, 'text/plain');
    }

    return logs;
  } catch (error) {
    console.error('Error saving cloud log:', error);
    throw error;
  }
}

// Upload file to GDrive folder (Multipart Upload)
export async function uploadFileToCloudFolder(folderId, file) {
  const metadata = {
    name: file.name,
    parents: [folderId]
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
    method: 'POST',
    headers: getAuthHeader(),
    body: form
  });

  if (!response.ok) {
    throw new Error(`구글 클라우드 업로드 실패: ${response.statusText}`);
  }

  return await response.json();
}

// 6. Create Google Calendar Event
export async function createCalendarEvent(summary, description, dateStr) {
  try {
    // dateStr format: YYYY-MM-DD
    // End date must be the day after the start date for all-day events
    const startDate = new Date(dateStr);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 1);

    const endDateStr = endDate.toISOString().split('T')[0];

    const event = {
      summary: summary,
      description: description,
      start: {
        date: dateStr
      },
      end: {
        date: endDateStr
      },
      // Yearly recurrence (for birthdays and anniversaries)
      recurrence: [
        'RRULE:FREQ=YEARLY'
      ]
    };

    const response = await window.gapi.client.calendar.events.insert({
      calendarId: 'primary',
      resource: event
    });

    return response.result;
  } catch (error) {
    console.error('Error creating calendar event:', error);
    throw error;
  }
}

// Helper: Create file inside folder
async function createFileInFolder(folderId, fileName, content, mimeType) {
  const metadata = {
    name: fileName,
    mimeType: mimeType,
    parents: [folderId]
  };

  const file = new Blob([content], { type: mimeType });
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: getAuthHeader(),
    body: form
  });

  if (!response.ok) {
    throw new Error(`구글 파일 생성 실패: ${response.statusText}`);
  }

  return await response.json();
}

// Helper: Update existing file content
async function updateFileContent(fileId, content, mimeType) {
  const file = new Blob([content], { type: mimeType });

  const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: {
      ...getAuthHeader(),
      'Content-Type': mimeType
    },
    body: file
  });

  if (!response.ok) {
    throw new Error(`구글 파일 업데이트 실패: ${response.statusText}`);
  }

  return await response.json();
}
