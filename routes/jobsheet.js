const express = require('express');
const router = express.Router();
const db = require('../database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for signed jobsheet uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads', 'jobsheets')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const jsNo = req.params.id ? db.prepare('SELECT js_no FROM jobsheets WHERE id = ?').get(req.params.id)?.js_no || 'unknown' : 'unknown';
    cb(null, jsNo.replace(/\//g, '-') + '_' + Date.now() + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.pdf'];
  const ext = path.extname(file.originalname).toLowerCase();
  cb(null, allowed.includes(ext));
}});

// GET /api/jobsheets — list all
router.get('/', (req, res) => {
  const { search } = req.query;
  let jobsheets;
  if (search) {
    jobsheets = db.prepare('SELECT * FROM jobsheets WHERE js_no LIKE ? OR clinic_name LIKE ? ORDER BY date DESC, id DESC').all(`%${search}%`, `%${search}%`);
  } else {
    jobsheets = db.prepare('SELECT * FROM jobsheets ORDER BY date DESC, id DESC').all();
  }
  // Parse JSON fields
  jobsheets = jobsheets.map(js => ({
    ...js,
    type_of_service: JSON.parse(js.type_of_service || '{}'),
    issue_detail: JSON.parse(js.issue_detail || '{}'),
    checklist: JSON.parse(js.checklist || '{}'),
    payment_method: JSON.parse(js.payment_method || '{}')
  }));
  res.json(jobsheets);
});

// GET /api/jobsheets/:id — get single
router.get('/:id', (req, res) => {
  const js = db.prepare('SELECT * FROM jobsheets WHERE id = ?').get(req.params.id);
  if (!js) return res.status(404).json({ error: 'Not found' });
  js.type_of_service = JSON.parse(js.type_of_service || '{}');
  js.issue_detail = JSON.parse(js.issue_detail || '{}');
  js.checklist = JSON.parse(js.checklist || '{}');
  js.payment_method = JSON.parse(js.payment_method || '{}');
  res.json(js);
});

// POST /api/jobsheets — create
router.post('/', (req, res) => {
  const d = req.body;
  const result = db.prepare(`INSERT INTO jobsheets (js_no, date, time_start, time_end, clinic_acct_no, clinic_name, clinic_address, service_by, contact_person, tel_no, doctor_name, doctor_hp, email, medex_program, pro_db_ver, type_of_service, issue_detail, service_detail, suggestion, remark, checklist, charges, payment_method, job_status, signature_by, customer_rep) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    d.jsNo, d.date, d.timeStart, d.timeEnd, d.clinicAcctNo, d.clinicName, d.clinicAddress, d.serviceBy, d.contactPerson, d.telNo, d.doctorName, d.doctorHP, d.email, d.medexProgram, d.proDbVer,
    JSON.stringify(d.typeOfService || {}), JSON.stringify(d.issueDetail || {}), d.serviceDetail, d.suggestion, d.remark, JSON.stringify(d.checklist || {}), d.charges, JSON.stringify(d.paymentMethod || {}), d.jobStatus, d.signatureBy, d.customerRep
  );
  res.json({ success: true, id: result.lastInsertRowid });
});

// PUT /api/jobsheets/:id — update
router.put('/:id', (req, res) => {
  const d = req.body;
  db.prepare(`UPDATE jobsheets SET js_no=?, date=?, time_start=?, time_end=?, clinic_acct_no=?, clinic_name=?, clinic_address=?, service_by=?, contact_person=?, tel_no=?, doctor_name=?, doctor_hp=?, email=?, medex_program=?, pro_db_ver=?, type_of_service=?, issue_detail=?, service_detail=?, suggestion=?, remark=?, checklist=?, charges=?, payment_method=?, job_status=?, signature_by=?, customer_rep=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(
    d.jsNo, d.date, d.timeStart, d.timeEnd, d.clinicAcctNo, d.clinicName, d.clinicAddress, d.serviceBy, d.contactPerson, d.telNo, d.doctorName, d.doctorHP, d.email, d.medexProgram, d.proDbVer,
    JSON.stringify(d.typeOfService || {}), JSON.stringify(d.issueDetail || {}), d.serviceDetail, d.suggestion, d.remark, JSON.stringify(d.checklist || {}), d.charges, JSON.stringify(d.paymentMethod || {}), d.jobStatus, d.signatureBy, d.customerRep, req.params.id
  );
  res.json({ success: true });
});

// DELETE /api/jobsheets/:id — delete
router.delete('/:id', (req, res) => {
  // Also delete signed file if exists
  const js = db.prepare('SELECT signed_file_path FROM jobsheets WHERE id = ?').get(req.params.id);
  if (js && js.signed_file_path) {
    const filePath = path.join(__dirname, '..', js.signed_file_path);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  db.prepare('DELETE FROM jobsheets WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// POST /api/jobsheets/:id/upload — upload signed file
router.post('/:id/upload', upload.single('signedFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  // Delete old file if exists
  const js = db.prepare('SELECT signed_file_path FROM jobsheets WHERE id = ?').get(req.params.id);
  if (js && js.signed_file_path) {
    const oldPath = path.join(__dirname, '..', js.signed_file_path);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  const relativePath = 'uploads/jobsheets/' + req.file.filename;
  db.prepare('UPDATE jobsheets SET signed_file_path = ? WHERE id = ?').run(relativePath, req.params.id);
  res.json({ success: true, filePath: relativePath });
});

// GET /api/jobsheets/:id/signed — serve signed file
router.get('/:id/signed', (req, res) => {
  const js = db.prepare('SELECT signed_file_path FROM jobsheets WHERE id = ?').get(req.params.id);
  if (!js || !js.signed_file_path) return res.status(404).json({ error: 'No signed file' });
  const filePath = path.join(__dirname, '..', js.signed_file_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.sendFile(filePath);
});

module.exports = router;
