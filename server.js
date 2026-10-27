const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const QRCode = require('qrcode');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static('public'));

// Database Initialization
const db = new sqlite3.Database('./attendance.db', (err) => {
  if (err) console.error('Database connection error:', err);
  else console.log('Connected to SQLite database.');
});

// Create tables with section support
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT NOT NULL,
    section TEXT NOT NULL,
    session_code TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_code TEXT NOT NULL,
    section TEXT NOT NULL,
    student_id TEXT NOT NULL,
    student_name TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(session_code, student_id)
  )`);
});

// API 1: Create a new class session with Section & generate QR code (Dynamic for Cloud & Local)
app.post('/api/create-session', async (req, res) => {
  const { subject, section } = req.body;
  if (!subject || !section) return res.status(400).json({ error: 'Subject and Section are required.' });

  const sessionCode = `${subject.replace(/\s+/g, '-').toLowerCase()}-${section}-${Date.now()}`;
  const host = req.get('host');
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const qrUrl = `${protocol}://${host}/scan.html?session=${sessionCode}&section=${section}`;

  try {
    const qrImage = await QRCode.toDataURL(qrUrl);
    db.run(
      `INSERT INTO sessions (subject, section, session_code) VALUES (?, ?, ?)`,
      [subject, section, sessionCode],
      function (err) {
        if (err) return res.status(500).json({ error: 'Failed to create session.' });
        res.json({ success: true, sessionCode, qrImage, qrUrl, section });
      }
    );
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR Code.' });
  }
});

// API 2: Submit attendance (Student)
app.post('/api/submit-attendance', (req, res) => {
  const { sessionCode, section, studentId, studentName } = req.body;

  if (!sessionCode || !section || !studentId || !studentName) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  db.run(
    `INSERT INTO attendance (session_code, section, student_id, student_name) VALUES (?, ?, ?, ?)`,
    [sessionCode, section, studentId, studentName],
    function (err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: 'You have already checked in for this session.' });
        }
        return res.status(500).json({ error: 'Database recording error.' });
      }
      res.json({ success: true, message: 'Attendance recorded successfully!' });
    }
  );
});

// API 3: Get Attendance Logs for Dashboard
app.get('/api/attendance-logs/:sessionCode', (req, res) => {
  const { sessionCode } = req.params;
  db.all(
    `SELECT student_id, student_name, section, timestamp FROM attendance WHERE session_code = ? ORDER BY timestamp DESC`,
    [sessionCode],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Failed to retrieve logs.' });
      res.json({ logs: rows });
    }
  );
});

// API 4: Export Logs as CSV (Compatible with Google Sheets import)
app.get('/api/export-csv/:sessionCode', (req, res) => {
  const { sessionCode } = req.params;
  db.all(
    `SELECT student_id, student_name, section, timestamp FROM attendance WHERE session_code = ? ORDER BY timestamp DESC`,
    [sessionCode],
    (err, rows) => {
      if (err) return res.status(500).send('Error generating export.');
      
      let csv = 'Student ID,Student Name,Section,Timestamp\n';
      rows.forEach(r => {
        csv += `"${r.student_id}","${r.student_name}","${r.section}","${r.timestamp}"\n`;
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=attendance-${sessionCode}.csv`);
      res.status(200).send(csv);
    }
  );
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});