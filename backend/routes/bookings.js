const router = require('express').Router();
const mongoose = require('mongoose');

const Booking = mongoose.model('Booking');

router.get('/', async (req, res) => {
  try {
    const bookings = await Booking.find().sort({ checkIn: 1 });
    res.json(bookings);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:year/:month', async (req, res) => {
  try {
    const { year, month } = req.params;
    const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
    const endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59);
    const bookings = await Booking.find({
      $or: [
        { checkIn: { $gte: startDate, $lte: endDate } },
        { checkOut: { $gte: startDate, $lte: endDate } },
        { checkIn: { $lte: startDate }, checkOut: { $gte: endDate } }
      ]
    }).sort({ checkIn: 1 });
    res.json(bookings);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { guestName, checkIn, checkOut } = req.body;
    if (!guestName || !checkIn || !checkOut) {
      return res.status(400).json({ error: 'guestName, checkIn, and checkOut are required' });
    }
    const ciDate = new Date(checkIn);
    const coDate = new Date(checkOut);
    const ciHour = ciDate.getHours();
    if (ciHour < 12) return res.status(400).json({ error: 'Check-in must be between 12:00 and 24:00' });
    const coHour = coDate.getHours();
    if (coHour < 8 || coHour > 11) return res.status(400).json({ error: 'Check-out must be between 08:00 and 11:00' });
    const overlap = await Booking.findOne({
      $or: [{ checkIn: { $lt: coDate }, checkOut: { $gt: ciDate } }]
    });
    if (overlap) return res.status(409).json({ error: 'This time slot overlaps with an existing booking', existingBooking: overlap });
    const booking = await Booking.create({ guestName, checkIn: ciDate, checkOut: coDate });
    res.status(201).json(booking);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const booking = await Booking.findByIdAndDelete(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    res.json({ message: 'Booking cancelled', booking });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
