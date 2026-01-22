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
  // Cek apakah sudah ada Firebase app yang diinisialisasi
  if (admin.apps.length === 0) {
    // Untuk Vercel (production)
    if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
      console.log('Initializing Firebase for Vercel/Production...');
      
      // Pastikan environment variables ada
      if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_PRIVATE_KEY || !process.env.FIREBASE_CLIENT_EMAIL) {
        console.error('MISSING FIREBASE ENVIRONMENT VARIABLES:');
        console.error('FIREBASE_PROJECT_ID:', process.env.FIREBASE_PROJECT_ID ? '✓ Set' : '✗ Missing');
        console.error('FIREBASE_CLIENT_EMAIL:', process.env.FIREBASE_CLIENT_EMAIL ? '✓ Set' : '✗ Missing');
        console.error('FIREBASE_PRIVATE_KEY:', process.env.FIREBASE_PRIVATE_KEY ? `✓ Set (length: ${process.env.FIREBASE_PRIVATE_KEY.length})` : '✗ Missing');
        
        // Untuk sementara, kita buat tanpa Firebase (mode demo)
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
    } 
    // Untuk local development
    else {
      console.log('Initializing Firebase for Local Development...');
      
      try {
        // Coba load dari file
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
  
  // Set db jika Firebase berhasil diinisialisasi
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
    
    // Buat folder jika belum ada
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
    fileSize: 1024 * 1024 // 1MB
  },
  fileFilter: function (req, file, cb) {
    // Hanya terima file .txt
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
const MATA_PELAJARAN = 'PKWU';
const KELAS = 'XII TKJ 3';

// ========== MIDDLEWARE ==========
// Middleware untuk cek koneksi database
const checkDatabase = (req, res, next) => {
  if (!db || !firebaseInitialized) {
    // Jika Firebase tidak tersedia, gunakan data dummy
    req.demoMode = true;
    console.log('⚠️ Running in DEMO mode');
  }
  next();
};

// Middleware untuk error handling
app.use((req, res, next) => {
  res.locals.demoMode = !firebaseInitialized;
  next();
});

// ========== FUNGSI PREPARE TEMPLATE DATA ==========
// FUNGSI PREPARE TEMPLATE DATA - FIXED LENGKAP
function prepareTemplateData(laporan) {
  // Header data
  const headerData = {
    sekolah: laporan.sekolah || SEKOLAH,
    guru: laporan.guru || GURU,
    mataPelajaran: laporan.mataPelajaran || MATA_PELAJARAN,
    tanggal: laporan.tanggal || '.........',
    kelas: laporan.kelas || KELAS  // Tambahkan kelas untuk template
  };
  
  // Format data jadwal
  const jadwalData = [];
  if (laporan.jadwal && laporan.jadwal.length > 0) {
    laporan.jadwal.forEach((item) => {
      jadwalData.push({
        jamKe: item.jamKe || '...',
        kelas: laporan.kelas || KELAS,
        materi: item.materi || '.....................',
        metode: item.metode || '.....................',
        media: item.media || '..................',
        catatan: item.catatan || '.....................'
      });
    });
  }
  
  // Format data kehadiran
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
  
  // Format kendala - SELALU ADA MINIMAL 3 BARIS
  const kendalaData = [];
  if (laporan.kendala && laporan.kendala.trim() !== '') {
    const lines = laporan.kendala.split('\n').filter(line => line.trim());
    lines.forEach(line => {
      kendalaData.push({ text: line.trim() });
    });
  }
  
  // Tambahkan baris titik-titik sampai minimal 3 baris
  while (kendalaData.length < 3) {
    kendalaData.push({ text: '.....................................................................' });
  }
  
  // Format tindak lanjut - SELALU ADA MINIMAL 2 BARIS
  const tindakLanjutData = [];
  if (laporan.tindakLanjut && laporan.tindakLanjut.length > 0) {
    laporan.tindakLanjut.forEach((item) => {
      // Tambahkan jika ada data (tidak semua kosong)
      if (item.siswa && item.siswa.trim() !== '') {
        // Gunakan jenis yang dipilih user, atau default ke "Remedial / Pengayaan"
        let jenisText = 'Remedial / Pengayaan';
        if (item.jenis && item.jenis.trim() !== '') {
          jenisText = item.jenis.trim(); // "Remedial" atau "Pengayaan" saja
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
  
  // Tambahkan baris titik-titik sampai minimal 2 baris
  while (tindakLanjutData.length < 2) {
    tindakLanjutData.push({
      siswa: '...',
      jenis: 'Remedial / Pengayaan',
      waktu: '...',
      catatan: '...'
    });
  }
  
  // Format catatan tambahan - SELALU ADA MINIMAL 2 BARIS
  const catatanData = [];
  if (laporan.catatanTambahan && laporan.catatanTambahan.trim() !== '') {
    const lines = laporan.catatanTambahan.split('\n').filter(line => line.trim());
    lines.forEach(line => {
      catatanData.push({ text: line.trim() });
    });
  }
  
  // Tambahkan baris titik-titik sampai minimal 2 baris
  while (catatanData.length < 2) {
    catatanData.push({ text: '.....................................................................' });
  }
  
  console.log('=== DEBUG DATA ===');
  console.log('Kendala:', kendalaData);
  console.log('Tindak Lanjut:', tindakLanjutData);
  console.log('Catatan:', catatanData);
  console.log('==================');
  
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
    let siswaList = [];
    
    if (db && firebaseInitialized) {
      const siswaSnapshot = await db.collection('siswa').orderBy('urutan', 'asc').get();
      siswaList = siswaSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } else {
      // Data dummy untuk demo
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

// Rute untuk halaman siswa
app.get('/siswa', checkDatabase, async (req, res) => {
  try {
    let siswaList = [];
    
    if (db && firebaseInitialized) {
      const siswaSnapshot = await db.collection('siswa').orderBy('urutan', 'asc').get();
      siswaList = siswaSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } else {
      // Data dummy untuk demo
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

// Rute untuk menambahkan siswa
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
      // Demo mode - tampilkan pesan
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

// Upload siswa
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
    
    // Hapus file temp
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
      // Demo mode
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

// ========== ROUTE BARU: HAPUS SISWA ==========
app.post('/siswa/hapus/:id', checkDatabase, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (db && firebaseInitialized) {
      await db.collection('siswa').doc(id).delete();
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
    console.error('Error in /siswa/hapus route:', error);
    res.status(500).render('error', { 
      message: 'Error: ' + error.message,
      demoMode: !firebaseInitialized
    });
  }
});

// Simpan laporan harian
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
      // Demo mode - simpan ke file temporary
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
        .limit(50) // Batasi untuk performance
        .get();
      
      laporanList = laporanSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } else {
      // Data dummy untuk demo
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

// ========== ROUTE BARU: EDIT LAPORAN (GET) ==========
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
    
    // Get all siswa
    const siswaSnapshot = await db.collection('siswa').orderBy('urutan', 'asc').get();
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
      mataPelajaran: MATA_PELAJARAN,
      kelas: KELAS,
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

// ========== ROUTE BARU: HAPUS LAPORAN (POST) ==========
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

// ========== ROUTE BARU: EKSPOR KE DOCX (GET) ==========
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
    
    // Path ke template DOCX
    const templatePath = path.join(__dirname, 'templates', 'LAPORAN HERMAWAN.docx');
    
    // Cek apakah template ada
    if (!fs.existsSync(templatePath)) {
      return res.status(500).render('error', {
        message: 'Template DOCX tidak ditemukan. Pastikan file "LAPORAN HERMAWAN.docx" ada di folder templates/',
        demoMode: !firebaseInitialized
      });
    }
    
    // Baca template
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
    
    // Siapkan data untuk template
    const templateData = prepareTemplateData(laporan);
    
    console.log('=== TEMPLATE DATA ===');
    console.log(JSON.stringify(templateData, null, 2));
    console.log('===================');
    
    // Set data ke template
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
    
    // Generate buffer
    const buffer = docxTemplate.getZip().generate({
      type: 'nodebuffer',
      compression: 'DEFLATE'
    });
    
    // Kirim sebagai file download
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

// Debug route untuk cek environment
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