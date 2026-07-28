// app/(auth)/onboarding.tsx - Simplified version without complex animations

import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ScrollView,
  StatusBar,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Colors, S, R } from "../../utils/theme";

const SLIDES = [
  {
    id: 1,
    icon: "💰",
    title: "Track Your Savings",
    description: "Record monthly contributions, view your personal savings balance, and stay on top of the group's total funds in real time.",
    color: Colors.accent,
    gradient: ["#0D9488", "#0F766E", "#0A5C52"],
    features: [
      "Real-time balance updates",
      "Contribution history",
      "Group savings overview",
    ],
  },
  {
    id: 2,
    icon: "🏦",
    title: "Smart Loan Management",
    description: "Apply for loans, track repayments with progress bars, and monitor outstanding balances — all in one transparent place.",
    color: "#F59E0B",
    gradient: ["#F59E0B", "#D97706", "#B45309"],
    features: [
      "3-step approval process",
      "Auto-calculated interest",
      "Repayment tracking",
    ],
  },
  {
    id: 3,
    icon: "📈",
    title: "Smart Investments",
    description: "Grow your wealth with group investments. Track returns, monitor performance, and make informed financial decisions.",
    color: "#7C3AED",
    gradient: ["#7C3AED", "#6D28D9", "#5B21B6"],
    features: [
      "Investment tracking",
      "ROI calculations",
      "Maturity alerts",
    ],
  },
  {
    id: 4,
    icon: "📊",
    title: "Reports & Insights",
    description: "View savings charts, member statements, and investment tracking to keep the entire group financially accountable.",
    color: Colors.primary,
    gradient: ["#1A3C5E", "#0D2840", "#081A2A"],
    features: [
      "Export CSV/PDF",
      "Visual analytics",
      "Member statements",
    ],
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  // Reactive width — updates on rotation/resize, unlike a module-level
  // Dimensions.get("window") snapshot taken once at import time. On wide
  // screens (web/tablet) the carousel is capped to a comfortable reading
  // width instead of stretching edge-to-edge.
  const { width: screenWidth } = useWindowDimensions();
  const width = Math.min(screenWidth, 480);
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollViewRef = useRef<ScrollView>(null);

  const currentSlide = SLIDES[currentIndex];
  const isLast = currentIndex === SLIDES.length - 1;

  const handleNext = async () => {
    if (isLast) {
      await AsyncStorage.setItem("onboarding_completed", "true");
      router.replace("/(auth)/register");
    } else {
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      scrollViewRef.current?.scrollTo({ x: nextIndex * width, animated: true });
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      const prevIndex = currentIndex - 1;
      setCurrentIndex(prevIndex);
      scrollViewRef.current?.scrollTo({ x: prevIndex * width, animated: true });
    }
  };

  const handleSkip = async () => {
    await AsyncStorage.setItem("onboarding_completed", "true");
    router.replace("/(auth)/register");
  };

  const onScroll = (event: any) => {
    const x = event.nativeEvent.contentOffset.x;
    const index = Math.round(x / width);
    if (index !== currentIndex) {
      setCurrentIndex(index);
    }
  };

  const renderFeatures = (features: string[]) => (
    <View style={styles.featuresList}>
      {features.map((feature, idx) => (
        <View key={idx} style={styles.featureItem}>
          <View style={[styles.featureDot, { backgroundColor: currentSlide.color }]} />
          <Text style={styles.featureText}>{feature}</Text>
        </View>
      ))}
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      
      {/* Background Gradient */}
      <LinearGradient
        colors={currentSlide.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.background}
      />

      {/* Decorative Elements */}
      <View style={styles.decorCircle1} />
      <View style={styles.decorCircle2} />
      <View style={styles.decorCircle3} />

      {/* Skip Button */}
      <TouchableOpacity style={styles.skipButton} onPress={handleSkip} activeOpacity={0.7}>
        <Text style={styles.skipText}>Skip</Text>
      </TouchableOpacity>

      {/* Slides ScrollView */}
      <ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={styles.scrollView}
      >
        {SLIDES.map((slide, index) => (
          <View key={slide.id} style={[styles.slide, { width }]}>
            <View style={styles.slideContent}>
              {/* Icon Circle */}
              <View style={styles.iconCircle}>
                <LinearGradient
                  colors={["rgba(255,255,255,0.25)", "rgba(255,255,255,0.1)"]}
                  style={styles.iconBackground}
                >
                  <Text style={styles.icon}>{slide.icon}</Text>
                </LinearGradient>
              </View>

              {/* Number Badge */}
              <View style={styles.numberBadge}>
                <Text style={styles.numberText}>
                  {String(index + 1).padStart(2, "0")}
                </Text>
              </View>

              {/* Title */}
              <Text style={styles.title}>{slide.title}</Text>

              {/* Description */}
              <Text style={styles.description}>{slide.description}</Text>

              {/* Features */}
              {renderFeatures(slide.features)}
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Pagination Dots */}
      <View style={styles.dotsContainer}>
        {SLIDES.map((_, index) => (
          <TouchableOpacity
            key={index}
            onPress={() => {
              setCurrentIndex(index);
              scrollViewRef.current?.scrollTo({ x: index * width, animated: true });
            }}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.dot,
                index === currentIndex && styles.dotActive,
                index === currentIndex && { backgroundColor: currentSlide.color },
              ]}
            />
          </TouchableOpacity>
        ))}
      </View>

      {/* Navigation Buttons */}
      <View style={styles.navigation}>
        {currentIndex > 0 && (
          <TouchableOpacity style={styles.prevButton} onPress={handlePrevious}>
            <LinearGradient
              colors={["rgba(255,255,255,0.15)", "rgba(255,255,255,0.05)"]}
              style={styles.prevButtonGradient}
            >
              <Text style={styles.prevButtonText}>← Back</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
        
        <TouchableOpacity
          style={[styles.nextButton, { backgroundColor: currentSlide.color }]}
          onPress={handleNext}
        >
          <LinearGradient
            colors={[currentSlide.color, currentSlide.gradient[1]]}
            style={styles.nextButtonGradient}
          >
            <Text style={styles.nextButtonText}>
              {isLast ? "Get Started" : "Next"}
            </Text>
            <Text style={styles.nextButtonArrow}>→</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* Progress Bar */}
      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${((currentIndex + 1) / SLIDES.length) * 100}%` as any,
                backgroundColor: currentSlide.color,
              },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  background: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  decorCircle1: {
    position: "absolute",
    top: -80,
    right: -80,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  decorCircle2: {
    position: "absolute",
    bottom: -60,
    left: -60,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  decorCircle3: {
    position: "absolute",
    top: "40%",
    left: -40,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  skipButton: {
    position: "absolute",
    top: Platform.OS === "ios" ? 60 : 40,
    right: S.lg,
    zIndex: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  skipText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  scrollView: {
    flex: 1,
  },
  slide: {
    // width is applied inline at the call site (depends on component-local
    // responsive `width`, not available at StyleSheet module scope)
    flex: 1,
  },
  slideContent: {
    flex: 1,
    paddingHorizontal: S.lg,
    paddingTop: Platform.OS === "ios" ? 100 : 80,
    paddingBottom: 40,
    alignItems: "center",
  },
  iconCircle: {
    marginBottom: 24,
  },
  iconBackground: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.3)",
  },
  icon: {
    fontSize: 48,
  },
  numberBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  numberText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#fff",
    textAlign: "center",
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  description: {
    fontSize: 15,
    color: "rgba(255,255,255,0.85)",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 32,
    paddingHorizontal: 20,
  },
  featuresList: {
    width: "100%" as any,
    marginBottom: 24,
    paddingHorizontal: 20,
  },
  featureItem: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  featureDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 12,
  },
  featureText: {
    fontSize: 14,
    color: "rgba(255,255,255,0.85)",
  },
  dotsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    marginBottom: 20,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.4)",
  },
  dotActive: {
    width: 24,
  },
  navigation: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: S.lg,
    marginBottom: 20,
  },
  prevButton: {
    flex: 1,
    borderRadius: R.lg,
    overflow: "hidden",
  },
  prevButtonGradient: {
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    borderRadius: R.lg,
  },
  prevButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  nextButton: {
    flex: 2,
    borderRadius: R.lg,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  nextButtonGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    gap: 8,
  },
  nextButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  nextButtonArrow: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  progressContainer: {
    paddingHorizontal: S.lg,
    marginBottom: Platform.OS === "ios" ? 20 : 16,
  },
  progressBar: {
    height: 4,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%" as any,
    borderRadius: 2,
  },
});