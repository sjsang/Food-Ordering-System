const reviewRepository = require('../repositories/review.repository');

const getFeaturedReviews = async (req, res) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 3;
        const result = await reviewRepository.getFeaturedReviews({ page, limit });
        res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
    } catch (error) {
        console.error('Error fetching featured reviews:', error);
        res.status(500).json({ success: false, message: 'Không thể tải đánh giá nổi bật.' });
    }
};

const getRecentReviews = async (req, res) => {
    try {
        const limit = Number(req.query.limit) || 6;
        const reviews = await reviewRepository.getRecentReviews(limit);
        res.status(200).json({ success: true, data: reviews });
    } catch (error) {
        console.error('Error fetching reviews:', error);
        res.status(500).json({ success: false, message: 'Không thể tải đánh giá.' });
    }
};

const getReviewsForAdmin = async (req, res) => {
    try {
        const queryOptions = {
            search: String(req.query.search || "").trim(),
            rating: String(req.query.rating || "all").trim(),
            featured: String(req.query.featured || "all").trim(),
            page: Number(req.query.page || 1),
            limit: Number(req.query.limit || 10),
            sortDir: String(req.query.sortDir || "desc").trim()
        };

        const result = await reviewRepository.getReviewsForAdmin(queryOptions);
        res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
    } catch (error) {
        console.error('Error fetching admin reviews:', error);
        res.status(500).json({ success: false, message: 'Không thể tải danh sách đánh giá.' });
    }
};

const toggleFeaturedReview = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });
        }

        const updated = await reviewRepository.setFeaturedReview(id);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy đánh giá.' });
        }

        res.status(200).json({ success: true, data: updated });
    } catch (error) {
        console.error('Error toggling featured review:', error);
        res.status(500).json({ success: false, message: 'Không thể cập nhật trạng thái nổi bật.' });
    }
};

module.exports = { getFeaturedReviews, getRecentReviews, getReviewsForAdmin, toggleFeaturedReview };

