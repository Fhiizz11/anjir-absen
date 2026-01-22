const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const { format } = require('date-fns');
const { id } = require('date-fns/locale');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');

// ========== FIREBASE INITIALIZATION ==========
console.log('Environment:', process.env.NODE_ENV);
console.log('VERCEL:', process.env.VERCEL);

let db = null;
let firebaseInitialized = false;

try {
  if (admin.apps.length === 0) {
    if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
      console.log('Initializing Firebase for Vercel/Production...');
      
      if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_PRIVATE_KEY || !process.env.FIREBASE_CLIENT_EMAIL) {
        console.error('MISSING FIREBASE ENVIRONMENT VARIABLES');
        console.log('Running in DEMO mode without Firebase');
      } else {
        const serviceAccount = {
          type: "service_account",
          project_id: process.env.FIREBASE_PROJECT_ID,
          private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          client_email: process.env.FIREBASE_CLIENT_EMAIL,
          client_id: "",
          auth_uri: "https://accounts.google.com/o/oauth2/auth",
          token_uri: "https://oauth2.googleapis.com/token",
          auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
          client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(process.env.FIREBASE_CLIENT_EMAIL)}`
        };
        
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
        console.log('✅ Firebase initialized successfully');
        firebaseInitialized = true;
      }
    } else {
      console.log('Initializing Firebase for Local Development...');
      
      try {
        const serviceAccount = require('./serviceAccountKey.json');
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
        console.log('✅ Firebase initialized from local file');
        firebaseInitialized = true;
      } catch (localError) {
        console.warn('⚠️ Cannot load local Firebase config:', localError.message);
        console.log('Running in DEMO mode without Firebase');
      }
    }
  } else {
    console.log('✅ Firebase already initialized');
    firebaseInitialized = true;
  }
  
  if (firebaseInitialized) {
    db = admin.firestore();
    console.log('✅ Firestore database initialized');
  }
} catch (firebaseError) {
  console.error('❌ Firebase initialization failed:', firebaseError.message);
  console.log('Running in DEMO mode without Firebase');
}

// ========== MULTER CONFIGURATION ==========
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = process.env.VERCEL ? '/tmp/uploads' : 'uploads';
    
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + '.txt');
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    if (file.mimetype === 'text/plain' || path.extname(file.originalname) === '.txt') {
      cb(null, true);
    } else {
      cb(new Error('Hanya file .txt yang diizinkan'), false);
    }
  }
});

// Data konstan
const SEKOLAH = 'SMK N 1 CIKARANG UTARA';
const GURU = 'HERMAWAN, S.Kom';
const MATA_PELAJARAN = 'KK TKJ';
const KELAS = 'XII TKJ 3';

// ========== MIDDLEWARE ==========
const checkDatabase = (req, res, next) => {
  if (!db || !firebaseInitialized) {
    req.demoMode = true;
    console.log('⚠️ Running in DEMO mode');
  }
  next();
};

app.use((req, res, next) => {
  res.locals.demoMode = !firebaseInitialized;
  next();
});

// ========== ROUTES ==========

app.get('/', checkDatabase, async (req, res) => {
  try {
    let siswaList = [];
    
    if (db && firebaseInitialized) {
      const siswaSnapshot = await db.collection('siswa').orderBy('urutan', 'asc').get();
      siswaList = siswaSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } else {
      siswaList = [
        { id: '1', nama: 'SISWA DEMO 1', urutan: 1 },
        { id: '2', nama: 'SISWA DEMO 2', urutan: 2 },
        { id: '3', nama: 'SISWA DEMO 3', urutan: 3 }
      ];
    }
    
    res.render('index', {
      sekolah: SEKOLAH,
      guru: GURU,
      mataPelajaran: MATA_PELAJARAN,
      kelas: KELAS,
      tanggal: format(new Date(), 'EEEE, dd MMMM yyyy', { locale: id }),
      siswaList: siswaList,
      demoMode: !firebaseInitialized
    });
  } catch (error) {
    console.error('Error in / route:', error);
    res.status(500).render('error', { 
      message: 'Terjadi kesalahan: ' + error.message,
      demoMode: !firebaseInitialized
    });
  }
});

app.get('/siswa', checkDatabase, async (req, res) => {
  try {
    let siswaList = [];
    
    if (db && firebaseInitialized) {
      const siswaSnapshot = await db.collection('siswa').orderBy('urutan', 'asc').get();
      siswaList = siswaSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } else {
      siswaList = [
        { id: 'demo1', nama: 'SISWA DEMO 1', urutan: 1, createdAt: new Date() },
        { id: 'demo2', nama: 'SISWA DEMO 2', urutan: 2, createdAt: new Date() },
        { id: 'demo3', nama: 'SISWA DEMO 3', urutan: 3, createdAt: new Date() }
      ];
    }
    
    res.render('siswa', { 
      siswaList: siswaList,
      demoMode: !firebaseInitialized
    });
  } catch (error) {
    console.error('Error in /siswa route:', error);
    res.status(500).render('error', { 
      message: 'Error: ' + error.message,
      demoMode: !firebaseInitialized
    });
  }
});

app.post('/siswa/tambah', checkDatabase, async (req, res) => {
  try {
    const { nama } = req.body;
    
    if (!nama) {
      return res.status(400).send('Nama siswa diperlukan');
    }
    
    if (db && firebaseInitialized) {
      const lastSiswa = await db.collection('siswa')
        .orderBy('urutan', 'desc')
        .limit(1)
        .get();
      
      let urutan = 1;
      if (!lastSiswa.empty) {
        const lastData = lastSiswa.docs[0].data();
        urutan = (lastData.urutan || 0) + 1;
      }
      
      await db.collection('siswa').add({
        nama: nama.trim(),
        createdAt: new Date(),
        urutan: urutan
      });
      
      res.redirect('/siswa');
    } else {
      res.render('message', {
        title: 'Demo Mode',
        message: 'Fitur ini tidak tersedia dalam mode demo. Database Firebase belum dikonfigurasi.',
        redirectUrl: '/siswa',
        demoMode: true
      });
    }
  } catch (error) {
    console.error('Error in /siswa/tambah route:', error);
    res.status(500).render('error', { 
      message: 'Error: ' + error.message,
      demoMode: !firebaseInitialized
    });
  }
});

app.post('/siswa/upload', checkDatabase, upload.single('fileSiswa'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).render('error', { 
        message: 'File tidak ditemukan',
        demoMode: !firebaseInitialized
      });
    }
    
    const filePath = req.file.path;
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const namaSiswa = fileContent.split('\n')
      .map(line => line.trim())
      .filter(line => line !== '');
    
    try {
      fs.unlinkSync(filePath);
    } catch (unlinkError) {
      console.warn('Cannot delete temp file:', unlinkError);
    }
    
    if (namaSiswa.length === 0) {
      return res.status(400).render('error', { 
        message: 'File kosong atau format tidak valid',
        demoMode: !firebaseInitialized
      });
    }
    
    if (db && firebaseInitialized) {
      const lastSiswa = await db.collection('siswa')
        .orderBy('urutan', 'desc')
        .limit(1)
        .get();
      
      let startUrutan = 1;
      if (!lastSiswa.empty) {
        const lastData = lastSiswa.docs[0].data();
        startUrutan = (lastData.urutan || 0) + 1;
      }
      
      const batch = db.batch();
      const timestamp = new Date();
      
      namaSiswa.forEach((nama, index) => {
        const docRef = db.collection('siswa').doc();
        batch.set(docRef, {
          nama: nama,
          createdAt: new Date(timestamp.getTime() + (index * 1000)),
          urutan: startUrutan + index
        });
      });
      
      await batch.commit();
      res.redirect('/siswa');
    } else {
      res.render('message', {
        title: 'Demo Mode',
        message: `File berhasil dibaca (${namaSiswa.length} siswa). Database Firebase belum dikonfigurasi.`,
        redirectUrl: '/siswa',
        demoMode: true
      });
    }
  } catch (error) {
    console.error('Error in /siswa/upload route:', error);
    res.status(500).render('error', { 
      message: 'Error: ' + error.message,
      demoMode: !firebaseInitialized
    });
  }
});

app.post('/simpan-laporan', checkDatabase, async (req, res) => {
  try {
    const data = req.body;
    const tanggal = data.tanggal || format(new Date(), 'yyyy-MM-dd');
    
    const jadwal = [];
    if (data.jamKe && Array.isArray(data.jamKe)) {
      for (let i = 0; i < data.jamKe.length; i++) {
        jadwal.push({
          jamKe: data.jamKe[i],
          materi: data.materi ? data.materi[i] : '',
          metode: data.metode ? data.metode[i] : '',
          media: data.media ? data.media[i] : '',
          catatan: data.catatanJadwal ? data.catatanJadwal[i] : ''
        });
      }
    }
    
    const kehadiran = [];
    if (data.siswaId && Array.isArray(data.siswaId)) {
      for (let i = 0; i < data.siswaId.length; i++) {
        kehadiran.push({
          siswaId: data.siswaId[i],
          siswaNama: data.siswaNama ? data.siswaNama[i] : '',
          status: data.kehadiran ? data.kehadiran[i] : 'H',
          partisipasi: data.partisipasi ? data.partisipasi[i] : 'Aktif',
          catatan: data.catatanSiswa ? data.catatanSiswa[i] : ''
        });
      }
    }
    
    const tindakLanjut = [];
    if (data.tlSiswa && Array.isArray(data.tlSiswa)) {
      for (let i = 0; i < data.tlSiswa.length; i++) {
        tindakLanjut.push({
          siswa: data.tlSiswa[i],
          jenis: data.tlJenis ? data.tlJenis[i] : '',
          waktu: data.tlWaktu ? data.tlWaktu[i] : '',
          catatan: data.tlCatatan ? data.tlCatatan[i] : ''
        });
      }
    }
    
    const laporanData = {
      sekolah: SEKOLAH,
      guru: GURU,
      mataPelajaran: MATA_PELAJARAN,
      kelas: KELAS,
      tanggal: data.tanggalDisplay || format(new Date(), 'EEEE, dd MMMM yyyy', { locale: id }),
      tanggalKey: tanggal,
      jadwal: jadwal,
      kendala: data.kendala || '',
      tindakLanjut: tindakLanjut,
      catatanTambahan: data.catatanTambahan || '',
      kehadiran: kehadiran,
      createdAt: new Date()
    };
    
    if (db && firebaseInitialized) {
      const docRef = await db.collection('laporan').add(laporanData);
      res.json({ 
        success: true, 
        message: 'Laporan berhasil disimpan',
        id: docRef.id
      });
    } else {
      const demoId = 'demo-' + Date.now();
      res.json({ 
        success: true, 
        message: 'Laporan berhasil disimpan (DEMO MODE)',
        id: demoId,
        demoMode: true
      });
    }
  } catch (error) {
    console.error('Error in /simpan-laporan route:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error: ' + error.message,
      demoMode: !firebaseInitialized
    });
  }
});

app.get('/rekap', checkDatabase, async (req, res) => {
  try {
    let laporanList = [];
    
    if (db && firebaseInitialized) {
      const laporanSnapshot = await db.collection('laporan')
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();
      
      laporanList = laporanSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } else {
      laporanList = [
        {
          id: 'demo1',
          tanggal: 'Senin, 01 Januari 2024',
          tanggalKey: '2024-01-01',
          kelas: KELAS,
          jadwal: [{ jamKe: '1-2', materi: 'Demo Materi' }],
          kehadiran: [{ siswaNama: 'Siswa Demo', status: 'H' }],
          createdAt: new Date()
        }
      ];
    }
    
    res.render('rekap', { 
      laporanList: laporanList,
      demoMode: !firebaseInitialized
    });
  } catch (error) {
    console.error('Error in /rekap route:', error);
    res.status(500).render('error', { 
      message: 'Error: ' + error.message,
      demoMode: !firebaseInitialized
    });
  }
});

app.get('/debug', (req, res) => {
  res.json({
    nodeEnv: process.env.NODE_ENV,
    vercel: process.env.VERCEL,
    firebaseInitialized: firebaseInitialized,
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID ? 'Set' : 'Not set',
    firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL ? 'Set' : 'Not set',
    firebasePrivateKey: process.env.FIREBASE_PRIVATE_KEY ? `Set (length: ${process.env.FIREBASE_PRIVATE_KEY.length})` : 'Not set',
    port: process.env.PORT,
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    firebase: firebaseInitialized ? 'Connected' : 'Demo Mode',
    timestamp: new Date().toISOString()
  });
});

app.use((req, res) => {
  res.status(404).render('error', {
    message: 'Halaman tidak ditemukan',
    demoMode: !firebaseInitialized
  });
});

app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(500).render('error', {
    message: 'Terjadi kesalahan internal server',
    demoMode: !firebaseInitialized
  });
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`Server berjalan di http://localhost:${port}`);
  });
}

module.exports = app;