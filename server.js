import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 5000;

// Google Drive Root Path
const GOOGLE_DRIVE_ROOT = 'G:\\다른 컴퓨터\\Onions\\광북금융솔루션_2026\\01_장기보험_고객관리';

app.use(cors());
app.use(express.json());

// Helper: Korean Initial Consonant (초성)
function getChoSeong(char) {
  const code = char.charCodeAt(0) - 0xAC00;
  if (code > -1 && code < 11172) {
    const choList = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
    const choIndex = Math.floor(code / 588);
    return choList[choIndex];
  }
  return char[0] || '';
}

// Helper: Safe path resolver to prevent directory traversal
function getCustomerPath(category, name) {
  const safeCategory = path.basename(category);
  const safeName = path.basename(name);
  return path.join(GOOGLE_DRIVE_ROOT, safeCategory, safeName);
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const { category, name } = req.query;
    if (!category || !name) {
      return cb(new Error('Category and name are required in query params'));
    }
    const customerPath = getCustomerPath(category, name);
    if (!fs.existsSync(customerPath)) {
      return cb(new Error(`Customer directory does not exist: ${customerPath}`));
    }
    cb(null, customerPath);
  },
  filename: (req, file, cb) => {
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, originalName);
  }
});
const upload = multer({ storage });

// API: List all customers
app.get('/api/customers', (req, res) => {
  try {
    if (!fs.existsSync(GOOGLE_DRIVE_ROOT)) {
      return res.status(404).json({ 
        error: 'Google Drive root directory not found.', 
        path: GOOGLE_DRIVE_ROOT,
        msg: '구글 드라이브 데스크톱 앱이 실행 중인지, 혹은 G: 드라이브 경로가 올바른지 확인해 주세요.'
      });
    }

    const categories = fs.readdirSync(GOOGLE_DRIVE_ROOT).filter(f => {
      const fullPath = path.join(GOOGLE_DRIVE_ROOT, f);
      return fs.statSync(fullPath).isDirectory() && !f.startsWith('00') && f !== '.' && f !== '..';
    });

    const customers = [];

    for (const category of categories) {
      const categoryPath = path.join(GOOGLE_DRIVE_ROOT, category);
      const items = fs.readdirSync(categoryPath);

      for (const item of items) {
        const customerPath = path.join(categoryPath, item);
        if (fs.statSync(customerPath).isDirectory()) {
          const jsonLogPath = path.join(customerPath, '상담일지.json');
          const hasLogs = fs.existsSync(jsonLogPath);
          const firstChar = item[0] || '';
          const choSeong = getChoSeong(firstChar);

          let address = '';
          let birthday = '';
          let contractDate = '';

          if (hasLogs) {
            try {
              const fileContent = JSON.parse(fs.readFileSync(jsonLogPath, 'utf8'));
              if (fileContent && !Array.isArray(fileContent) && fileContent.profile) {
                address = fileContent.profile.address || '';
                birthday = fileContent.profile.birthday || '';
                contractDate = fileContent.profile.contractDate || '';
              }
            } catch (e) {
              // ignore parse errors
            }
          }

          customers.push({
            name: item,
            category: category,
            choSeong: choSeong,
            hasLogs: hasLogs,
            path: customerPath,
            address,
            birthday,
            contractDate
          });
        }
      }
    }

    customers.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    res.json(customers);
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Get customer details (files, logs and profile)
app.get('/api/customers/details', (req, res) => {
  const { category, name } = req.query;
  if (!category || !name) {
    return res.status(400).json({ error: 'Category and name are required' });
  }

  try {
    const customerPath = getCustomerPath(category, name);
    if (!fs.existsSync(customerPath)) {
      return res.status(404).json({ error: 'Customer folder not found' });
    }

    // Read files
    const allFiles = fs.readdirSync(customerPath);
    const files = [];

    for (const file of allFiles) {
      const filePath = path.join(customerPath, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isFile() && file !== '상담일지.json' && file !== '상담일지_뷰어.txt') {
        files.push({
          name: file,
          size: stat.size,
          modified: stat.mtime,
          ext: path.extname(file).toLowerCase()
        });
      }
    }

    // Read consultation logs & profile info
    const logsPath = path.join(customerPath, '상담일지.json');
    let logs = [];
    let profile = { name, category, address: '', birthday: '', contractDate: '' };

    if (fs.existsSync(logsPath)) {
      try {
        const fileContent = JSON.parse(fs.readFileSync(logsPath, 'utf8'));
        if (fileContent && !Array.isArray(fileContent)) {
          // Object format (Structured)
          logs = fileContent.logs || [];
          profile = { ...profile, ...(fileContent.profile || {}) };
        } else if (Array.isArray(fileContent)) {
          // Legacy Array format
          logs = fileContent;
        }
      } catch (e) {
        console.error('Failed to parse logs JSON', e);
      }
    }

    res.json({
      name,
      category,
      path: customerPath,
      files,
      logs,
      profile
    });
  } catch (error) {
    console.error('Error fetching customer details:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Add consultation log (Saves as object containing logs & profile)
app.post('/api/customers/logs', (req, res) => {
  const { category, name, log } = req.body;
  if (!category || !name || !log) {
    return res.status(400).json({ error: 'Category, name, and log object are required' });
  }

  try {
    const customerPath = getCustomerPath(category, name);
    if (!fs.existsSync(customerPath)) {
      return res.status(404).json({ error: 'Customer folder not found' });
    }

    const logsPath = path.join(customerPath, '상담일지.json');
    let logs = [];
    let profile = { name, category, address: '', birthday: '', contractDate: '' };

    if (fs.existsSync(logsPath)) {
      try {
        const fileContent = JSON.parse(fs.readFileSync(logsPath, 'utf8'));
        if (fileContent && !Array.isArray(fileContent)) {
          logs = fileContent.logs || [];
          profile = fileContent.profile || profile;
        } else if (Array.isArray(fileContent)) {
          logs = fileContent;
        }
      } catch (e) {
        logs = [];
      }
    }

    const newLogEntry = {
      id: Date.now().toString(),
      date: log.date || new Date().toISOString().split('T')[0],
      type: log.type || '일반상담',
      inquiry: log.inquiry || '',
      analysis: log.analysis || '',
      proposal: log.proposal || '',
      postPlan: log.postPlan || '',
      files: log.files || []
    };

    logs.push(newLogEntry);

    // Save back as Structured Object
    fs.writeFileSync(logsPath, JSON.stringify({ profile, logs }, null, 2), 'utf8');

    // Update Human-Readable Text View
    const txtPath = path.join(customerPath, '상담일지_뷰어.txt');
    let txtContent = `==================================================\n`;
    txtContent += ` [고객 보장 분석 및 상담 일지 - ${name}]\n`;
    txtContent += `==================================================\n`;
    txtContent += `- 주소: ${profile.address || '미입력'}\n`;
    txtContent += `- 생년월일: ${profile.birthday || '미입력'}\n`;
    txtContent += `- 계약일자: ${profile.contractDate || '미입력'}\n`;
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

    fs.writeFileSync(txtPath, txtContent, 'utf8');

    res.json({ success: true, logs });
  } catch (error) {
    console.error('Error writing consultation log:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Register new customer & auto-create folders (Local Bootstrapper)
app.post('/api/customers', (req, res) => {
  const { name, category, address, birthday, contractDate } = req.body;
  if (!name || !category) {
    return res.status(400).json({ error: 'Name and category are required' });
  }

  try {
    // 1. Ensure ROOT folder exists
    if (!fs.existsSync(GOOGLE_DRIVE_ROOT)) {
      fs.mkdirSync(GOOGLE_DRIVE_ROOT, { recursive: true });
      // Create standard categories as well
      const standardCats = ['ㄱ', 'ㄴ~ㅅ', 'ㅇ', 'ㅈ~ㅎ', '#기업', '#소개고객', '99_계약종료_고객'];
      for (const cat of standardCats) {
        fs.mkdirSync(path.join(GOOGLE_DRIVE_ROOT, cat), { recursive: true });
      }
    }

    // 2. Ensure Category folder exists
    const categoryPath = path.join(GOOGLE_DRIVE_ROOT, category);
    if (!fs.existsSync(categoryPath)) {
      fs.mkdirSync(categoryPath, { recursive: true });
    }

    // 3. Create Customer folder
    const customerPath = path.join(categoryPath, name);
    if (fs.existsSync(customerPath)) {
      return res.status(400).json({ error: '이미 존재하는 고객 폴더 이름입니다.' });
    }
    fs.mkdirSync(customerPath, { recursive: true });

    // 4. Initialize 상담일지.json with profile info
    const logsPath = path.join(customerPath, '상담일지.json');
    const profile = { name, category, address: address || '', birthday: birthday || '', contractDate: contractDate || '' };
    fs.writeFileSync(logsPath, JSON.stringify({ profile, logs: [] }, null, 2), 'utf8');

    // 5. Initialize 상담일지_뷰어.txt
    const txtPath = path.join(customerPath, '상담일지_뷰어.txt');
    let txtContent = `==================================================\n`;
    txtContent += ` [고객 보장 분석 및 상담 일지 - ${name}]\n`;
    txtContent += `==================================================\n`;
    txtContent += `- 주소: ${profile.address || '미입력'}\n`;
    txtContent += `- 생년월일: ${profile.birthday || '미입력'}\n`;
    txtContent += `- 계약일자: ${profile.contractDate || '미입력'}\n`;
    txtContent += `==================================================\n\n`;
    txtContent += `[시스템] 고객 카드가 새로 생성되었습니다.\n`;
    fs.writeFileSync(txtPath, txtContent, 'utf8');

    res.json({ success: true, customer: { name, category, path: customerPath } });
  } catch (error) {
    console.error('Error creating customer:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Update customer profile details
app.post('/api/customers/profile', (req, res) => {
  const { category, name, profile } = req.body;
  if (!category || !name || !profile) {
    return res.status(400).json({ error: 'Category, name, and profile details are required' });
  }

  try {
    const customerPath = getCustomerPath(category, name);
    if (!fs.existsSync(customerPath)) {
      return res.status(404).json({ error: 'Customer folder not found' });
    }

    const logsPath = path.join(customerPath, '상담일지.json');
    let logs = [];
    let oldProfile = { name, category, address: '', birthday: '', contractDate: '' };

    if (fs.existsSync(logsPath)) {
      try {
        const fileContent = JSON.parse(fs.readFileSync(logsPath, 'utf8'));
        if (fileContent && !Array.isArray(fileContent)) {
          logs = fileContent.logs || [];
          oldProfile = fileContent.profile || oldProfile;
        } else if (Array.isArray(fileContent)) {
          logs = fileContent;
        }
      } catch (e) {
        // use empty
      }
    }

    // Merge profiles
    const updatedProfile = {
      ...oldProfile,
      address: profile.address !== undefined ? profile.address : oldProfile.address,
      birthday: profile.birthday !== undefined ? profile.birthday : oldProfile.birthday,
      contractDate: profile.contractDate !== undefined ? profile.contractDate : oldProfile.contractDate,
    };

    // Save JSON
    fs.writeFileSync(logsPath, JSON.stringify({ profile: updatedProfile, logs }, null, 2), 'utf8');

    // Update TXT Viewer
    const txtPath = path.join(customerPath, '상담일지_뷰어.txt');
    let txtContent = `==================================================\n`;
    txtContent += ` [고객 보장 분석 및 상담 일지 - ${name}]\n`;
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

    fs.writeFileSync(txtPath, txtContent, 'utf8');

    res.json({ success: true, profile: updatedProfile });
  } catch (error) {
    console.error('Error updating customer profile:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Handle file upload
app.post('/api/customers/upload', upload.array('files'), (req, res) => {
  res.json({ success: true, files: req.files.map(f => f.filename) });
});

// API: Open customer folder
app.post('/api/customers/open-folder', (req, res) => {
  const { category, name } = req.body;
  if (!category || !name) {
    return res.status(400).json({ error: 'Category and name are required' });
  }

  try {
    const customerPath = getCustomerPath(category, name);
    if (!fs.existsSync(customerPath)) {
      return res.status(404).json({ error: 'Customer folder not found' });
    }

    exec(`explorer.exe "${customerPath}"`, (err) => {
      if (err) {
        console.error('Failed to open folder:', err);
        return res.status(500).json({ error: 'Failed to open folder' });
      }
      res.json({ success: true });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Open file
app.post('/api/customers/open-file', (req, res) => {
  const { category, name, fileName } = req.body;
  if (!category || !name || !fileName) {
    return res.status(400).json({ error: 'Category, name, and fileName are required' });
  }

  try {
    const customerPath = getCustomerPath(category, name);
    const filePath = path.join(customerPath, fileName);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    exec(`cmd.exe /c start "" "${filePath}"`, (err) => {
      if (err) {
        console.error('Failed to open file:', err);
        return res.status(500).json({ error: 'Failed to open file' });
      }
      res.json({ success: true });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve frontend build static files
const buildPath = path.join(__dirname, 'dist');
if (fs.existsSync(buildPath)) {
  app.use(express.static(buildPath));
  app.get('*all', (req, res) => {
    res.sendFile(path.join(buildPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`InsureChart Local Server running at http://localhost:${PORT}`);
});
