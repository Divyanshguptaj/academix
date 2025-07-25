import { instance } from "../config/razorpay.js";
import Course from "../models/Course.js";
import crypto from "crypto";
import User from "../models/User.js";
import mailSender from "../utils/mailSender.js";
import mongoose from "mongoose";
import { paymentSuccessEmail } from "../mail/templates/paymentSuccessEmail.js";

// Capture the payment and initiate the Razorpay order
export const capturePayment = async (req, res) => {
  try {
    const { courses, userDetails } = req.body;
    const userId = userDetails._id;
    
    if (!courses || courses.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Please Provide Course ID" });
    }

    let total_amount = 0;
    for (const courseObj of courses) {
      let course;
      try {
        // Ensure we're extracting the actual courseId
        const course_id = courseObj.courseId || courseObj; 
        
        if (!mongoose.Types.ObjectId.isValid(course_id)) {
          return res
            .status(400)
            .json({
              success: false,
              message: `Invalid Course ID: ${course_id}`,
            });
        }

        // Find the course by its ID
        course = await Course.findById(course_id);
        // console.log(course)
        if (!course) {
          return res
            .status(404)
            .json({ success: false, message: "Could not find the Course" });
        }
        // Check if the user is already enrolled
        const uid = new mongoose.Types.ObjectId(userId);
        if (course.studentsEnrolled.includes(uid)) {
          return res
            .status(400)
            .json({ success: false, message: "Student is already Enrolled" });
        }

        // const updated = await User.findByIdAndUpdate(
        //   userId,
        //   { $push: { courses: course_id } },
        //   { new: true }
        // );
        total_amount += course.price;
      } catch (error) {
        // console.error("Error finding course:", error);
        return res.status(500).json({ success: false, message: error.message });
      }
    }

    const options = {
      amount: total_amount * 100,
      currency: "INR",
      receipt: Math.random(Date.now()).toString(),
    };
    // Initiate the payment using Razorpay
    const paymentResponse = await instance.orders.create(options);
    // console.log(paymentResponse);
    return res.json({
      success: true,
      message: paymentResponse,
      key: process.env.RAZORPAY_KEY_ID, // ✅ send this to frontend
    });
  } catch (error) {
    console.error("Error processing payment:", error);
    return res
      .status(500)
      .json({ success: false, message: "Could not initiate order." });
  }
};

// verify the payment
export const verifyPayment = async (req, res) => {
  // console.log("object32");
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      courses,
      userDetails,
    } = req.body;
    const userId = userDetails._id;

    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature ||
      !courses ||
      !userId
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Payment Failed" });
    }

    let body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_SECRET)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res
        .status(400)
        .json({ success: false, message: "Payment Failed" });
    }

    // Call enrollStudents without sending response here
    await enrollStudents(courses, userId);

    return res.status(200).json({ success: true, message: "Payment Verified" });
  } catch (error) {
    console.error("Error verifying payment:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Send Payment Success Email
export const sendPaymentSuccessEmail = async (req, res) => {
  const { orderId, paymentId, amount } = req.body;
  // console.log(req.body);
  const userId = req.body.userDetails._id;

  if (!orderId || !paymentId || !amount || !userId) {
    return res
      .status(400)
      .json({ success: false, message: "Please provide all the details" });
  }

  try {
    const enrolledStudent = await User.findById(userId);

    await mailSender(
      enrolledStudent.email,
      `Payment Received`,
      paymentSuccessEmail(
        `${enrolledStudent.firstName} ${enrolledStudent.lastName}`,
        amount / 100,
        orderId,
        paymentId
      )
    );
  } catch (error) {
    console.log("error in sending mail", error);
    return res
      .status(400)
      .json({ success: false, message: "Could not send email" });
  }
};

// enroll the student in the courses
const enrollStudents = async (courses, userId) => {
  try {
    for (const course of courses) {
      const courseId = typeof course === "object" ? course.courseId : course;

      if (!mongoose.Types.ObjectId.isValid(courseId)) {
        console.error(`Invalid course ID: ${courseId}`);
        continue;
      }

      const courseDoc = await Course.findById(courseId);
      if (!courseDoc) {
        console.error(`Course with ID ${courseId} not found`);
        continue;
      }

      const uid = new mongoose.Types.ObjectId(userId);

      // Enroll user in the course if not already enrolled
      if (!courseDoc.studentsEnrolled.includes(uid)) {
        courseDoc.studentsEnrolled.push(uid);
        await courseDoc.save();

        // Add course to user's document too
        await User.findByIdAndUpdate(
          userId,
          { $addToSet: { courses: courseId } }, // prevents duplicates
          { new: true }
        );
      }
    }
  } catch (error) {
    console.error("Error enrolling student:", error);
  }
};