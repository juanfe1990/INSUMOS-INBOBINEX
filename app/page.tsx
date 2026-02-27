import { AboutSection } from '@/components/about-section';
import { ContactSection } from '@/components/contact-section';
import { FeaturesStrip } from '@/components/features-strip';
import { Footer } from '@/components/footer';
import { HeroSection } from '@/components/hero-section';
import { Navbar } from '@/components/navbar';
import { ProductsSection } from '@/components/products-section';
import WppButton from '@/components/wppButton';

export default function HomePage() {
    return (
        <main>
            <Navbar />
            <HeroSection />
            <ProductsSection />
            <AboutSection />
            <FeaturesStrip />
            <ContactSection />
            <WppButton />
            <Footer />
        </main>
    );
}
