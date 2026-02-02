const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const { format } = require('date-fns');
const { id } = require('date-fns/locale');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const ExcelJS = require('exceljs');

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
        console.log('✅ Firebase initialized successfully on Vercel');
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
  limits: {
    fileSize: 1024 * 1024
  },
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

// ========== HELPER FUNCTIONS ==========
function getCurrentDateIndonesia() {
  // Menggunakan timezone Indonesia (WIB)
  const now = new Date();
  const options = { timeZone: 'Asia/Jakarta' };
  const indonesiaTime = new Date(now.toLocaleString('en-US', options));
  return indonesiaTime;
}

function formatTanggal(date) {
  return format(date, 'EEEE, dd MMMM yyyy', { locale: id });
}

function formatTanggalKey(date) {
  return format(date, 'yyyy-MM-dd');
}

// ========== FUNGSI PREPARE TEMPLATE DATA ==========
function prepareTemplateData(laporan) {
  const headerData = {
    sekolah: laporan.sekolah || SEKOLAH,
    guru: laporan.guru || GURU,
    mataPelajaran: laporan.mataPelajaran || '',
    tanggal: laporan.tanggal || '.........',
    kelas: laporan.kelas || ''
  };
  
  const jadwalData = [];
  if (laporan.jadwal && laporan.jadwal.length > 0) {
    laporan.jadwal.forEach((item) => {
      jadwalData.push({
        jamKe: item.jamKe || '...',
        kelas: laporan.kelas || '',
        materi: item.materi || '.....................',
        metode: item.metode || '.....................',
        media: item.media || '..................',
        catatan: item.catatan || '.....................'
      });
    });
  }
  
  const kehadiranData = [];
  if (laporan.kehadiran && laporan.kehadiran.length > 0) {
    laporan.kehadiran.forEach((item, index) => {
      kehadiranData.push({
        no: (index + 1).toString(),
        nama: item.siswaNama || '...',
        status: item.status || '...',
        partisipasi: (item.partisipasi || '...').toUpperCase(),
        catatan: item.catatan || '...'
      });
    });
  }
  
  const kendalaData = [];
  if (laporan.kendala && laporan.kendala.trim() !== '') {
    const lines = laporan.kendala.split('\n').filter(line => line.trim());
    lines.forEach(line => {
      kendalaData.push({ text: line.trim() });
    });
  }
  
  while (kendalaData.length < 3) {
    kendalaData.push({ text: '.....................................................................' });
  }
  
  const tindakLanjutData = [];
  if (laporan.tindakLanjut && laporan.tindakLanjut.length > 0) {
    laporan.tindakLanjut.forEach((item) => {
      if (item.siswa && item.siswa.trim() !== '') {
        let jenisText = 'Remedial / Pengayaan';
        if (item.jenis && item.jenis.trim() !== '') {
          jenisText = item.jenis.trim();
        }
        
        tindakLanjutData.push({
          siswa: item.siswa.trim(),
          jenis: jenisText,
          waktu: item.waktu && item.waktu.trim() !== '' ? item.waktu.trim() : '...',
          catatan: item.catatan && item.catatan.trim() !== '' ? item.catatan.trim() : '...'
        });
      }
    });
  }
  
  while (tindakLanjutData.length < 2) {
    tindakLanjutData.push({
      siswa: '...',
      jenis: 'Remedial / Pengayaan',
      waktu: '...',
      catatan: '...'
    });
  }
  
  const catatanData = [];
  if (laporan.catatanTambahan && laporan.catatanTambahan.trim() !== '') {
    const lines = laporan.catatanTambahan.split('\n').filter(line => line.trim());
    lines.forEach(line => {
      catatanData.push({ text: line.trim() });
    });
  }
  
  while (catatanData.length < 2) {
    catatanData.push({ text: '.....................................................................' });
  }
  
  return {
    ...headerData,
    jadwal: jadwalData,
    kehadiran: kehadiranData,
    kendala: kendalaData,
    tindakLanjut: tindakLanjutData,
    catatan: catatanData
  };
}

// ========== ROUTES ==========

// Rute utama - Form Laporan
app.get('/', checkDatabase, async (req, res) => {
  try {
    let kelasList = [];
    
    if (db && firebaseInitialized) {
      const kelasSnapshot = await db.collection('kelas').orderBy('createdAt', 'asc').get();
      kelasList = kelasSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } else {
      kelasList = [
        { id: 'demo1', namaKelas: 'XII TKJ 3', mataPelajaran: 'PKWU' }
      ];
    }
    
    const currentDate = getCurrentDateIndonesia();
    
    res.render('index', {
      sekolah: SEKOLAH,
      guru: GURU,
      tanggal: formatTanggal(currentDate),
      tanggalKey: formatTanggalKey(currentDate),
      kelasList: kelasList,
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

// API: Get siswa by kelas
app.get('/api/siswa/:kelasId', checkDatabase, async (req, res) => {
  try {
    const { kelasId } = req.params;
    
    if (!db || !firebaseInitialized) {
      return res.json([]);
    }
    
    const siswaSnapshot = await db.collection('siswa')
      .where('kelasId', '==', kelasId)
      .orderBy('urutan', 'asc')
      .get();
    
    const siswaList = siswaSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    res.json(siswaList);
  } catch (error) {
    console.error('Error getting siswa:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== KELAS ROUTES ==========

// Halaman Data Siswa & Kelas
app.get('/siswa', checkDatabase, async (req, res) => {
  try {
    let kelasList = [];
    
    if (db && firebaseInitialized) {
      const kelasSnapshot = await db.collection('kelas').orderBy('createdAt', 'asc').get();
      kelasList = kelasSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      // Get siswa count for each kelas
      for (let kelas of kelasList) {
        const siswaSnapshot = await db.collection('siswa')
          .where('kelasId', '==', kelas.id)
          .get();
        kelas.jumlahSiswa = siswaSnapshot.size;
      }
    } else {
      kelasList = [
        { id: 'demo1', namaKelas: 'XII TKJ 3', mataPelajaran: 'PKWU', jumlahSiswa: 3 }
      ];
    }
    
    res.render('siswa', { 
      kelasList: kelasList,
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

// Tambah Kelas
app.post('/kelas/tambah', checkDatabase, async (req, res) => {
  try {
    const { namaKelas, mataPelajaran } = req.body;
    
    if (!namaKelas || !mataPelajaran) {
      return res.status(400).send('Nama kelas dan mata pelajaran diperlukan');
    }
    
    if (db && firebaseInitialized) {
      await db.collection('kelas').add({
        namaKelas: namaKelas.trim(),
        mataPelajaran: mataPelajaran.trim(),
        createdAt: new Date()
      });
      
      res.redirect('/siswa');
    } else {
      res.render('message', {
        title: 'Demo Mode',
        message: 'Fitur ini tidak tersedia dalam mode demo.',
        redirectUrl: '/siswa',
        demoMode: true
      });
    }
  } catch (error) {
    console.error('Error in /kelas/tambah:', error);
    res.status(500).render('error', { 
      message: 'Error: ' + error.message,
      demoMode: !firebaseInitialized
    });
  }
});

// Edit Kelas
app.post('/kelas/edit/:id', checkDatabase, async (req, res) => {
  try {
    const { id } = req.params;
    const { namaKelas, mataPelajaran } = req.body;
    
    if (!namaKelas || !mataPelajaran) {
      return res.status(400).send('Nama kelas dan mata pelajaran diperlukan');
    }
    
    if (db && firebaseInitialized) {
      await db.collection('kelas').doc(id).update({
        namaKelas: namaKelas.trim(),
        mataPelajaran: mataPelajaran.trim(),
        updatedAt: new Date()
      });
      
      res.redirect('/siswa');
    } else {
      res.render('message', {
        title: 'Demo Mode',
        message: 'Fitur edit tidak tersedia dalam mode demo.',
        redirectUrl: '/siswa',
        demoMode: true
      });
    }
  } catch (error) {
    console.error('Error in /kelas/edit:', error);
    res.status(500).render('error', { 
      message: 'Error: ' + error.message,
      demoMode: !firebaseInitialized
    });
  }
});

// Hapus Kelas
app.post('/kelas/hapus/:id', checkDatabase, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (db && firebaseInitialized) {
      // Hapus semua siswa di kelas ini juga
      const siswaSnapshot = await db.collection('siswa')
        .where('kelasId', '==', id)
        .get();
      
      const batch = db.batch();
      siswaSnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      batch.delete(db.collection('kelas').doc(id));
      await batch.commit();
      
      res.redirect('/siswa');
    } else {
      res.render('message', {
        title: 'Demo Mode',
        message: 'Fitur hapus tidak tersedia dalam mode demo.',
        redirectUrl: '/siswa',
        demoMode: true
      });
    }
  } catch (error) {
    console.error('Error in /kelas/hapus:', error);
    res.status(500).render('error', { 
      message: 'Error: ' + error.message,
      demoMode: !firebaseInitialized
    });
  }
});

// ========== SISWA ROUTES ==========

// Detail Kelas & Siswa
app.get('/siswa/kelas/:kelasId', checkDatabase, async (req, res) => {
  try {
    const { kelasId } = req.params;
    
    if (!db || !firebaseInitialized) {
      return res.render('message', {
        title: 'Demo Mode',
        message: 'Fitur ini tidak tersedia dalam mode demo.',
        redirectUrl: '/siswa',
        demoMode: true
      });
    }
    
    const kelasDoc = await db.collection('kelas').doc(kelasId).get();
    if (!kelasDoc.exists) {
      return res.status(404).render('error', {
        message: 'Kelas tidak ditemukan',
        demoMode: !firebaseInitialized
      });
    }
    
    const kelas = { id: kelasDoc.id, ...kelasDoc.data() };
    
    const siswaSnapshot = await db.collection('siswa')
      .where('kelasId', '==', kelasId)
      .orderBy('urutan', 'asc')
      .get();
    
    const siswaList = siswaSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    res.render('siswa-detail', {
      kelas: kelas,
      siswaList: siswaList,
      demoMode: !firebaseInitialized
    });
  } catch (error) {
    console.error('Error in /siswa/kelas:', error);
    res.status(500).render('error', { 
      message: 'Error: ' + error.message,
      demoMode: !firebaseInitialized
    });
  }
});

// Tambah Siswa
app.post('/siswa/tambah', checkDatabase, async (req, res) => {
  try {
    const { nama, kelasId } = req.body;
    
    if (!nama || !kelasId) {
      return res.status(400).send('Nama siswa dan kelas diperlukan');
    }
    
    if (db && firebaseInitialized) {
      const lastSiswa = await db.collection('siswa')
        .where('kelasId', '==', kelasId)
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
        kelasId: kelasId,
        createdAt: new Date(),
        urutan: urutan
      });
      
      res.redirect('/siswa/kelas/' + kelasId);
    } else {
      res.render('message', {
        title: 'Demo Mode',
        message: 'Fitur ini tidak tersedia dalam mode demo.',
        redirectUrl: '/siswa',
        demoMode: true
      });
    }
  } catch (error) {
    console.error('Error in /siswa/tambah:', error);
    res.status(500).render('error', { 
      message: 'Error: ' + error.message,
      demoMode: !firebaseInitialized
    });
  }
});

// Edit Siswa
app.post('/siswa/edit/:id', checkDatabase, async (req, res) => {
  try {
    const { id } = req.params;
    const { nama, kelasId } = req.body;
    
    if (!nama) {
      return res.status(400).send('Nama siswa diperlukan');
    }
    
    if (db && firebaseInitialized) {
      await db.collection('siswa').doc(id).update({
        nama: nama.trim(),
        updatedAt: new Date()
      });
      
      res.redirect('/siswa/kelas/' + kelasId);
    } else {
      res.render('message', {
        title: 'Demo Mode',
        message: 'Fitur edit tidak tersedia dalam mode demo.',
        redirectUrl: '/siswa',
        demoMode: true
      });
    }
  } catch (error) {
    console.error('Error in /siswa/edit:', error);
    res.status(500).render('error', { 
      message: 'Error: ' + error.message,
      demoMode: !firebaseInitialized
    });
  }
});

// Hapus Siswa
app.post('/siswa/hapus/:id', checkDatabase, async (req, res) => {
  try {
    const { id } = req.params;
    const { kelasId } = req.body;
    
    if (db && firebaseInitialized) {
      await db.collection('siswa').doc(id).delete();
      res.redirect('/siswa/kelas/' + kelasId);
    } else {
      res.render('message', {
        title: 'Demo Mode',
        message: 'Fitur hapus tidak tersedia dalam mode demo.',
        redirectUrl: '/siswa',
        demoMode: true
      });
    }
  } catch (error) {
    console.error('Error in /siswa/hapus:', error);
    res.status(500).render('error', { 
      message: 'Error: ' + error.message,
      demoMode: !firebaseInitialized
    });
  }
});

// Hapus Semua Siswa dalam Kelas
app.post('/siswa/hapus-semua/:kelasId', checkDatabase, async (req, res) => {
  try {
    const { kelasId } = req.params;
    
    if (db && firebaseInitialized) {
      const siswaSnapshot = await db.collection('siswa')
        .where('kelasId', '==', kelasId)
        .get();
      
      const batch = db.batch();
      siswaSnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      res.redirect('/siswa/kelas/' + kelasId);
    } else {
      res.render('message', {
        title: 'Demo Mode',
        message: 'Fitur hapus tidak tersedia dalam mode demo.',
        redirectUrl: '/siswa',
        demoMode: true
      });
    }
  } catch (error) {
    console.error('Error in /siswa/hapus-semua:', error);
    res.status(500).render('error', { 
      message: 'Error: ' + error.message,
      demoMode: !firebaseInitialized
    });
  }
});

// Upload Siswa
app.post('/siswa/upload', checkDatabase, upload.single('fileSiswa'), async (req, res) => {
  try {
    const { kelasId } = req.body;
    
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
        .where('kelasId', '==', kelasId)
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
          kelasId: kelasId,
          createdAt: new Date(timestamp.getTime() + (index * 1000)),
          urutan: startUrutan + index
        });
      });
      
      await batch.commit();
      res.redirect('/siswa/kelas/' + kelasId);
    } else {
      res.render('message', {
        title: 'Demo Mode',
        message: `File berhasil dibaca (${namaSiswa.length} siswa). Database Firebase belum dikonfigurasi.`,
        redirectUrl: '/siswa',
        demoMode: true
      });
    }
  } catch (error) {
    console.error('Error in /siswa/upload:', error);
    res.status(500).render('error', { 
      message: 'Error: ' + error.message,
      demoMode: !firebaseInitialized
    });
  }
});

// ========== REKAP ABSENSI SISWA ==========
app.get('/siswa/rekap/:siswaId', checkDatabase, async (req, res) => {
  try {
    const { siswaId } = req.params;
    
    if (!db || !firebaseInitialized) {
      return res.render('message', {
        title: 'Demo Mode',
        message: 'Fitur rekap tidak tersedia dalam mode demo.',
        redirectUrl: '/siswa',
        demoMode: true
      });
    }
    
    // Get siswa data
    const siswaDoc = await db.collection('siswa').doc(siswaId).get();
    if (!siswaDoc.exists) {
      return res.status(404).render('error', {
        message: 'Siswa tidak ditemukan',
        demoMode: !firebaseInitialized
      });
    }
    
    const siswa = { id: siswaDoc.id, ...siswaDoc.data() };
    
    // Get kelas data
    const kelasDoc = await db.collection('kelas').doc(siswa.kelasId).get();
    const kelas = kelasDoc.exists ? kelasDoc.data() : {};
    
    // Get all laporan that contains this siswa
    const laporanSnapshot = await db.collection('laporan')
      .where('kelas', '==', kelas.namaKelas)
      .orderBy('tanggalKey', 'asc')
      .get();
    
    const absensiData = [];
    let countHadir = 0;
    let countSakit = 0;
    let countIzin = 0;
    
    laporanSnapshot.docs.forEach(doc => {
      const laporan = doc.data();
      if (laporan.kehadiran && Array.isArray(laporan.kehadiran)) {
        const kehadiranSiswa = laporan.kehadiran.find(k => k.siswaNama === siswa.nama);
        if (kehadiranSiswa) {
          absensiData.push({
            tanggal: laporan.tanggal,
            tanggalKey: laporan.tanggalKey,
            status: kehadiranSiswa.status,
            partisipasi: kehadiranSiswa.partisipasi,
            catatan: kehadiranSiswa.catatan
          });
          
          if (kehadiranSiswa.status === 'H') countHadir++;
          else if (kehadiranSiswa.status === 'S') countSakit++;
          else if (kehadiranSiswa.status === 'I') countIzin++;
        }
      }
    });
    
    // Create Excel file
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Rekap Absensi');
    
    // Set column widths
    worksheet.columns = [
      { key: 'no', width: 5 },
      { key: 'tanggal', width: 25 },
      { key: 'status', width: 10 },
      { key: 'partisipasi', width: 15 },
      { key: 'catatan', width: 40 }
    ];
    
    // Title
    worksheet.mergeCells('A1:E1');
    const titleRow = worksheet.getCell('A1');
    titleRow.value = 'REKAP ABSENSI SISWA';
    titleRow.font = { size: 16, bold: true };
    titleRow.alignment = { horizontal: 'center', vertical: 'middle' };
    
    // Info Siswa
    worksheet.mergeCells('A3:B3');
    worksheet.getCell('A3').value = 'Nama Siswa';
    worksheet.getCell('A3').font = { bold: true };
    worksheet.mergeCells('C3:E3');
    worksheet.getCell('C3').value = siswa.nama;
    
    worksheet.mergeCells('A4:B4');
    worksheet.getCell('A4').value = 'Kelas';
    worksheet.getCell('A4').font = { bold: true };
    worksheet.mergeCells('C4:E4');
    worksheet.getCell('C4').value = kelas.namaKelas || '';
    
    worksheet.mergeCells('A5:B5');
    worksheet.getCell('A5').value = 'Mata Pelajaran';
    worksheet.getCell('A5').font = { bold: true };
    worksheet.mergeCells('C5:E5');
    worksheet.getCell('C5').value = kelas.mataPelajaran || '';
    
    // Header tabel
    const headerRow = worksheet.getRow(7);
    headerRow.values = ['No', 'Tanggal', 'Status', 'Partisipasi', 'Catatan'];
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    
    // Data rows
    absensiData.forEach((item, index) => {
      const row = worksheet.addRow({
        no: index + 1,
        tanggal: item.tanggal,
        status: item.status,
        partisipasi: item.partisipasi,
        catatan: item.catatan
      });
      
      // Styling berdasarkan status
      const statusCell = row.getCell('status');
      if (item.status === 'H') {
        statusCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF92D050' }
        };
      } else if (item.status === 'S') {
        statusCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFC000' }
        };
      } else if (item.status === 'I') {
        statusCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF00B0F0' }
        };
      }
      
      row.alignment = { vertical: 'middle' };
    });
    
    // Ringkasan
    const summaryStartRow = worksheet.lastRow.number + 3;
    
    worksheet.mergeCells(`A${summaryStartRow}:B${summaryStartRow}`);
    worksheet.getCell(`A${summaryStartRow}`).value = 'RINGKASAN KEHADIRAN';
    worksheet.getCell(`A${summaryStartRow}`).font = { bold: true, size: 12 };
    
    worksheet.getCell(`A${summaryStartRow + 1}`).value = 'Hadir (H)';
    worksheet.getCell(`A${summaryStartRow + 1}`).font = { bold: true };
    worksheet.getCell(`B${summaryStartRow + 1}`).value = countHadir;
    worksheet.getCell(`B${summaryStartRow + 1}`).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF92D050' }
    };
    
    worksheet.getCell(`A${summaryStartRow + 2}`).value = 'Sakit (S)';
    worksheet.getCell(`A${summaryStartRow + 2}`).font = { bold: true };
    worksheet.getCell(`B${summaryStartRow + 2}`).value = countSakit;
    worksheet.getCell(`B${summaryStartRow + 2}`).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFC000' }
    };
    
    worksheet.getCell(`A${summaryStartRow + 3}`).value = 'Izin (I)';
    worksheet.getCell(`A${summaryStartRow + 3}`).font = { bold: true };
    worksheet.getCell(`B${summaryStartRow + 3}`).value = countIzin;
    worksheet.getCell(`B${summaryStartRow + 3}`).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF00B0F0' }
    };
    
    worksheet.getCell(`A${summaryStartRow + 4}`).value = 'TOTAL';
    worksheet.getCell(`A${summaryStartRow + 4}`).font = { bold: true };
    worksheet.getCell(`B${summaryStartRow + 4}`).value = absensiData.length;
    worksheet.getCell(`B${summaryStartRow + 4}`).font = { bold: true };
    
    // Add borders to all cells with data
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber >= 7) {
        row.eachCell({ includeEmpty: true }, (cell) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        });
      }
    });
    
    // Generate file
    const fileName = `Rekap_Absensi_${siswa.nama.replace(/\s+/g, '_')}_${Date.now()}.xlsx`;
    const filePath = path.join(process.env.VERCEL ? '/tmp' : __dirname, fileName);
    
    await workbook.xlsx.writeFile(filePath);
    
    // Send file
    res.download(filePath, fileName, (err) => {
      if (err) {
        console.error('Error sending file:', err);
      }
      // Clean up
      try {
        fs.unlinkSync(filePath);
      } catch (unlinkError) {
        console.warn('Cannot delete temp file:', unlinkError);
      }
    });
    
  } catch (error) {
    console.error('Error in /siswa/rekap:', error);
    res.status(500).render('error', { 
      message: 'Error: ' + error.message,
      demoMode: !firebaseInitialized
    });
  }
});

// ========== LAPORAN ROUTES ==========

// Simpan laporan harian
app.post('/simpan-laporan', checkDatabase, async (req, res) => {
  try {
    const data = req.body;
    
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
      mataPelajaran: data.mataPelajaran || '',
      kelas: data.kelas || '',
      tanggal: data.tanggalDisplay || '',
      tanggalKey: data.tanggalKey || formatTanggalKey(getCurrentDateIndonesia()),
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

// Halaman rekap
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
          kelas: 'XII TKJ 3',
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

// Edit Laporan (GET)
app.get('/rekap/edit/:id', checkDatabase, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!db || !firebaseInitialized) {
      return res.render('message', {
        title: 'Demo Mode',
        message: 'Fitur edit tidak tersedia dalam mode demo.',
        redirectUrl: '/rekap',
        demoMode: true
      });
    }
    
    const laporanDoc = await db.collection('laporan').doc(id).get();
    
    if (!laporanDoc.exists) {
      return res.status(404).render('error', {
        message: 'Laporan tidak ditemukan',
        demoMode: !firebaseInitialized
      });
    }
    
    const laporan = laporanDoc.data();
    
    // Get kelas for this laporan
    const kelasSnapshot = await db.collection('kelas')
      .where('namaKelas', '==', laporan.kelas)
      .limit(1)
      .get();
    
    let kelasId = null;
    if (!kelasSnapshot.empty) {
      kelasId = kelasSnapshot.docs[0].id;
    }
    
    // Get all siswa for this kelas
    const siswaSnapshot = await db.collection('siswa')
      .where('kelasId', '==', kelasId)
      .orderBy('urutan', 'asc')
      .get();
    
    const siswaList = siswaSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Merge siswa with kehadiran data
    const kehadiranDenganSiswa = siswaList.map(siswa => {
      const kehadiranData = laporan.kehadiran?.find(k => k.siswaId === siswa.id);
      return {
        siswaId: siswa.id,
        siswaNama: siswa.nama,
        status: kehadiranData?.status || 'H',
        partisipasi: kehadiranData?.partisipasi || 'Aktif',
        catatan: kehadiranData?.catatan || ''
      };
    });
    
    res.render('edit', {
      laporanId: id,
      laporan: laporan,
      sekolah: SEKOLAH,
      guru: GURU,
      kehadiranDenganSiswa: kehadiranDenganSiswa,
      demoMode: !firebaseInitialized
    });
  } catch (error) {
    console.error('Error in /rekap/edit route:', error);
    res.status(500).render('error', { 
      message: 'Error: ' + error.message,
      demoMode: !firebaseInitialized
    });
  }
});

// Update Laporan (POST)
app.post('/rekap/update/:id', checkDatabase, async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    
    if (!db || !firebaseInitialized) {
      return res.render('message', {
        title: 'Demo Mode',
        message: 'Fitur update tidak tersedia dalam mode demo.',
        redirectUrl: '/rekap',
        demoMode: true
      });
    }
    
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
    
    const updateData = {
      jadwal: jadwal,
      kendala: data.kendala || '',
      tindakLanjut: tindakLanjut,
      catatanTambahan: data.catatanTambahan || '',
      kehadiran: kehadiran,
      updatedAt: new Date()
    };
    
    await db.collection('laporan').doc(id).update(updateData);
    res.redirect('/rekap');
    
  } catch (error) {
    console.error('Error in /rekap/update route:', error);
    res.status(500).render('error', { 
      message: 'Error: ' + error.message,
      demoMode: !firebaseInitialized
    });
  }
});

// Hapus Laporan (POST)
app.post('/rekap/hapus/:id', checkDatabase, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!db || !firebaseInitialized) {
      return res.render('message', {
        title: 'Demo Mode',
        message: 'Fitur hapus tidak tersedia dalam mode demo.',
        redirectUrl: '/rekap',
        demoMode: true
      });
    }
    
    await db.collection('laporan').doc(id).delete();
    res.redirect('/rekap');
  } catch (error) {
    console.error('Error in /rekap/hapus route:', error);
    res.status(500).render('error', { 
      message: 'Error: ' + error.message,
      demoMode: !firebaseInitialized
    });
  }
});

// Ekspor ke DOCX (GET)
app.get('/ekspor/:id', checkDatabase, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!db || !firebaseInitialized) {
      return res.render('message', {
        title: 'Demo Mode',
        message: 'Fitur ekspor tidak tersedia dalam mode demo.',
        redirectUrl: '/rekap',
        demoMode: true
      });
    }
    
    const laporanDoc = await db.collection('laporan').doc(id).get();
    
    if (!laporanDoc.exists) {
      return res.status(404).render('error', {
        message: 'Laporan tidak ditemukan',
        demoMode: !firebaseInitialized
      });
    }
    
    const laporan = laporanDoc.data();
    
    const templatePath = path.join(__dirname, 'templates', 'LAPORAN HERMAWAN.docx');
    
    if (!fs.existsSync(templatePath)) {
      return res.status(500).render('error', {
        message: 'Template DOCX tidak ditemukan. Pastikan file "LAPORAN HERMAWAN.docx" ada di folder templates/',
        demoMode: !firebaseInitialized
      });
    }
    
    const content = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(content);
    
    let docxTemplate;
    try {
      docxTemplate = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
      });
    } catch (error) {
      console.error('Error loading template:', error);
      return res.status(500).render('error', {
        message: 'Error loading template: ' + error.message,
        demoMode: !firebaseInitialized
      });
    }
    
    const templateData = prepareTemplateData(laporan);
    
    try {
      docxTemplate.setData(templateData);
      docxTemplate.render();
    } catch (error) {
      console.error('Error rendering template:', error);
      if (error.properties && error.properties.errors) {
        console.error('Detailed errors:', error.properties.errors);
      }
      return res.status(500).render('error', {
        message: 'Error rendering template: ' + error.message,
        demoMode: !firebaseInitialized
      });
    }
    
    const buffer = docxTemplate.getZip().generate({
      type: 'nodebuffer',
      compression: 'DEFLATE'
    });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="Laporan_Harian_${laporan.tanggalKey || 'laporan'}.docx"`);
    res.send(buffer);
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).render('error', { 
      message: 'Error: ' + error.message,
      demoMode: !firebaseInitialized
    });
  }
});

// Debug route
app.get('/debug', (req, res) => {
  res.json({
    nodeEnv: process.env.NODE_ENV,
    vercel: process.env.VERCEL,
    firebaseInitialized: firebaseInitialized,
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID ? 'Set' : 'Not set',
    firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL ? 'Set' : 'Not set',
    firebasePrivateKey: process.env.FIREBASE_PRIVATE_KEY ? `Set (length: ${process.env.FIREBASE_PRIVATE_KEY.length})` : 'Not set',
    port: process.env.PORT,
    timestamp: new Date().toISOString(),
    indonesiaTime: getCurrentDateIndonesia().toISOString()
  });
});

// Health check route
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    firebase: firebaseInitialized ? 'Connected' : 'Demo Mode',
    timestamp: new Date().toISOString()
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).render('error', {
    message: 'Halaman tidak ditemukan',
    demoMode: !firebaseInitialized
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(500).render('error', {
    message: 'Terjadi kesalahan internal server',
    demoMode: !firebaseInitialized
  });
});

// Start server
if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`Server berjalan di http://localhost:${port}`);
    console.log(`Form Laporan: http://localhost:${port}`);
    console.log(`Data Siswa: http://localhost:${port}/siswa`);
    console.log(`Rekap Laporan: http://localhost:${port}/rekap`);
    console.log(`Debug: http://localhost:${port}/debug`);
    console.log(`Health: http://localhost:${port}/health`);
  });
}

module.exports = app;