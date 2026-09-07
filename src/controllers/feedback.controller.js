const feedbackRepository = require('../repositories/feedback.repository');

const createFeedback = async (req, res) => {
    try {
        const { full_name, email, content } = req.body;

        if (!full_name || !full_name.trim()) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập họ và tên.' });
        }
        if (!email || !email.trim()) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập email.' });
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) {
            return res.status(400).json({ success: false, message: 'Email không hợp lệ.' });
        }
        if (!content || !content.trim()) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập nội dung góp ý.' });
        }

        const feedback = await feedbackRepository.createFeedback({
            full_name: full_name.trim(),
            email: email.trim(),
            content: content.trim()
        });

        res.status(201).json({ success: true, data: feedback, message: 'Gửi góp ý thành công!' });
    } catch (error) {
        console.error('Error creating feedback:', error);
        res.status(500).json({ success: false, message: 'Không thể gửi góp ý. Vui lòng thử lại.' });
    }
};

const getAllFeedbacks = async (req, res) => {
    try {
        const queryOptions = {
            search: String(req.query.search || '').trim(),
            is_read: String(req.query.is_read || 'all').trim(),
            page: Number(req.query.page || 1),
            limit: Number(req.query.limit || 10),
            sortDir: String(req.query.sortDir || 'desc').trim()
        };

        const result = await feedbackRepository.getAllFeedbacks(queryOptions);
        res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
    } catch (error) {
        console.error('Error fetching feedbacks:', error);
        res.status(500).json({ success: false, message: 'Không thể tải danh sách góp ý.' });
    }
};

const toggleReadFeedback = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });
        }

        const updated = await feedbackRepository.toggleReadFeedback(id);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy góp ý.' });
        }

        res.status(200).json({ success: true, data: updated });
    } catch (error) {
        console.error('Error toggling feedback read:', error);
        res.status(500).json({ success: false, message: 'Không thể cập nhật trạng thái.' });
    }
};

const deleteFeedback = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });
        }

        const deleted = await feedbackRepository.deleteFeedback(id);
        if (!deleted) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy góp ý.' });
        }

        res.status(200).json({ success: true, message: 'Đã xoá góp ý.' });
    } catch (error) {
        console.error('Error deleting feedback:', error);
        res.status(500).json({ success: false, message: 'Không thể xoá góp ý.' });
    }
};

module.exports = { createFeedback, getAllFeedbacks, toggleReadFeedback, deleteFeedback };
